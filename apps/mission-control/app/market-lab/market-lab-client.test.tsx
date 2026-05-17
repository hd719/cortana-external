import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarketLabClient } from "./market-lab-client";

const run = {
  run_id: "mlab_test_AAPL",
  symbol: "AAPL",
  requested_at: "2026-05-11T00:00:00Z",
  status: "done",
  trust_verdict: "blocked",
  verdict_reasons: ["price_data_stale"],
  run_dir: "/tmp/run",
  events_path: "/tmp/events.jsonl",
  logs_path: "/tmp/logs.txt",
};

const detail = {
  run,
  review: {
    trust_verdict: "blocked",
    verdict_reasons: ["price_data_stale"],
    interpretation: { summary: "Blocked because price data is stale." },
    price_facts: { price: 123.45, source: "fake", price_basis: "live" },
    spy_facts: { price: 500.0, source: "fake" },
    codex_review: {
      status: "attached",
      summary: "Codex says keep this blocked.",
      verdict: "blocked",
      session_id: "session-1",
      structured: {
        schema_version: "market-lab-codex-review/v1",
        verdict: "blocked",
        confidence: 0.86,
        horizon: "5d",
        summary: "Codex says keep this blocked.",
        hard_gate_assessment: "A deterministic stale-price blocker is present.",
        context_quality: "Price evidence is stale, so the review is blocked before analyst debate.",
        missing_context: ["fresh_price"],
        roles: [
          { role: "price_action", stance: "bearish", confidence: 0.9, summary: "Price is stale.", evidence_used: ["price_data_stale"], bull_points: [], bear_points: ["Fresh price gate failed."], missing_evidence: ["fresh_price"] },
          { role: "fundamentals", stance: "neutral", confidence: 0.4, summary: "Fundamentals are not decisive.", evidence_used: [], bull_points: [], bear_points: [], missing_evidence: ["fundamentals"] },
          { role: "news_sentiment", stance: "neutral", confidence: 0.4, summary: "News is not decisive.", evidence_used: [], bull_points: [], bear_points: [], missing_evidence: ["news"] },
          { role: "risk", stance: "bearish", confidence: 0.92, summary: "Risk blocks this review.", evidence_used: ["checks"], bull_points: [], bear_points: ["Blocker check exists."], missing_evidence: [] },
          { role: "final_judge", stance: "bearish", confidence: 0.86, summary: "The committee blocks the review.", evidence_used: ["price_action", "risk"], bull_points: [], bear_points: ["Required data is stale."], missing_evidence: ["fresh_price"] },
        ],
        what_would_change_verdict: ["Fresh Schwab price evidence."],
        operator_note: "Review-only note. Do not execute from this review.",
      },
    },
    artifact_paths: {
      review: "/tmp/review.json",
      events: "/tmp/events.jsonl",
      logs: "/tmp/logs.txt",
      codex_packet: "/tmp/codex-review-packet.md",
      codex_review: "/tmp/codex-review.md",
    },
    checks: [{ code: "price_data_stale", severity: "blocker", message: "stale" }],
    sentiment_snapshot: {
      status: "partial",
      missing_sources: ["stocktwits"],
      sources: [
        {
          source: "yahoo_finance_news",
          status: "available",
          sample_count: 3,
          fetch_method: "yahoo_finance_rss",
          summary: "AAPL headline sample",
        },
        {
          source: "stocktwits",
          status: "error",
          sample_count: 0,
          fetch_method: "stocktwits_public_stream",
          error_message: "HTTP 403",
        },
      ],
    },
    settlements: [{ window: "1d", status: "pending" }],
  },
  settlements: [{ window: "1d", status: "pending" }],
};

describe("MarketLabClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/settle-due") && init?.method === "POST") {
        return Response.json({ status: "ok", data: { settled_run_ids: ["mlab_test_AAPL"] } });
      }
      if (String(url).includes("/settle") && init?.method === "POST") {
        return Response.json({
          status: "ok",
          data: {
            run_id: run.run_id,
            symbol: run.symbol,
            settlements: [
              { window: "1d", status: "pending" },
              { window: "5d", status: "pending" },
              { window: "20d", status: "pending" },
            ],
          },
        });
      }
      if (String(url).includes("/codex-review") && init?.method === "POST") {
        return Response.json(
          { status: "ok", data: { streamId: "stream-1", packet_path: "/tmp/codex-review-packet.md" } },
          { status: 202 },
        );
      }
      if (String(url).includes("/codex-review") && !init?.method) {
        return Response.json(
          { status: "ok", data: { status: "not_requested", packet_path: "/tmp/codex-review-packet.md" } },
        );
      }
      if (String(url).includes("/api/codex/streams/stream-1")) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const send = (event: string, data: unknown) => {
              controller.enqueue(encoder.encode(`event: ${event}\n`));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            };
            send("lifecycle", { codexSessionId: "session-1" });
            send("codex_event", { type: "item.completed", item: { type: "agent_message" } });
            send("done", { session: { sessionId: "session-1" } });
            controller.close();
          },
        });
        return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      if (String(url).includes("/events")) {
        return Response.json({ status: "ok", data: [{ event: "done", message: "Run done", timestamp: "2026-05-11T00:02:00Z" }] });
      }
      if (String(url).includes("/api/market-lab/runs/") && !init?.method) {
        return Response.json({ status: "ok", data: detail });
      }
      if (String(url).includes("/api/market-lab/runs") && init?.method === "POST") {
        return Response.json({ status: "ok", data: { run_id: run.run_id } }, { status: 201 });
      }
      return Response.json({ status: "ok", data: { runs: [run] } });
    }));
  });

  it("renders blocked verdict, timeline, Codex summary, and artifact paths", async () => {
    render(<MarketLabClient />);

    await screen.findByText("Blocked because price data is stale.");

    expect(screen.getAllByText(/blocked/i).length).toBeGreaterThan(0);
    // Timeline: compact by default, expandable when the operator needs the full run path.
    expect(screen.queryByText(/Current:/)).toBeNull();
    expect(screen.queryByText(/Step 1 of 1/)).toBeNull();
    expect(screen.queryByText("Run done")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /show/i }));
    expect(screen.getByText(/Current:/)).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 1/)).toBeInTheDocument();
    expect(screen.getByText("Run done")).toBeInTheDocument();
    expect(document.querySelector('[aria-current="step"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /hide/i }));
    expect(screen.queryByText(/Current:/)).toBeNull();
    expect(screen.queryByText(/Step 1 of 1/)).toBeNull();
    expect(screen.queryByText("Run done")).toBeNull();
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
    expect(screen.getAllByText("Yahoo news").length).toBeGreaterThan(0);
    // News & sentiment: Codex one-liner replaces the old "News analysis" column; summary still renders.
    expect(screen.getAllByText("News is not decisive.").length).toBeGreaterThan(0);
    expect(screen.getByText("AAPL headline sample")).toBeInTheDocument();
    // Evidence: bullish/bearish row is hidden when both arrays empty (fixture has no points).
    expect(screen.queryByText("No bullish points.")).toBeNull();
    expect(screen.queryByText("No bearish points.")).toBeNull();
    expect(screen.getByText("Codex review ready")).toBeInTheDocument();
    expect(screen.getByText("Codex says keep this blocked.")).toBeInTheDocument();
    expect(screen.queryByText("Price action")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /expand codex review/i }));
    expect(screen.getByText("Price action")).toBeInTheDocument();
    expect(screen.getByText("Price evidence is stale, so the review is blocked before analyst debate.")).toBeInTheDocument();
    expect(screen.getAllByText("fresh_price").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /collapse codex review/i }));
    expect(screen.queryByText("Price action")).toBeNull();
    expect(screen.getByText("/tmp/review.json")).toBeInTheDocument();
    expect(screen.getByText("/tmp/codex-review-packet.md")).toBeInTheDocument();
  });

  it("wraps long timeline event messages", async () => {
    const longMessage =
      "Codex review attached from /Users/hd/Developer/cortana-external/.cache/market_lab/prod/runs/mlab_20260515T204412Z_DIS/codex-review.md";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/events")) {
        return Response.json({
          status: "ok",
          data: [{ event: "codex_review_attached", message: longMessage, timestamp: "2026-05-11T00:02:00Z" }],
        });
      }
      if (String(url).includes("/api/market-lab/runs/") && !init?.method) {
        return Response.json({ status: "ok", data: detail });
      }
      return Response.json({ status: "ok", data: { runs: [run] } });
    }));

    render(<MarketLabClient />);

    await screen.findByRole("button", { name: /show/i });
    expect(screen.queryByText(/Current:/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /show/i }));
    const eventMessage = await screen.findByText(longMessage);
    expect(eventMessage).toHaveClass("min-w-0");
    expect(eventMessage).toHaveClass("break-words");
    expect(eventMessage.className).toContain("[overflow-wrap:anywhere]");
  });

  it("starts a run for the entered symbol", async () => {
    render(<MarketLabClient />);
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "msft" } });
    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/market-lab/runs",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ symbol: "MSFT" }),
        }),
      );
    });
  });

  it("does not ask Codex automatically after a run starts", async () => {
    render(<MarketLabClient />);
    fireEvent.click(await screen.findByRole("button", { name: /^run$/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/market-lab/runs",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const codexPosts = vi
      .mocked(fetch)
      .mock.calls.filter(([url, init]) => String(url).includes("/codex-review") && init?.method === "POST");
    expect(codexPosts).toHaveLength(0);
  });

  it("uses latest Schwab cache when the run saved unavailable portfolio context", async () => {
    const trustedRun = {
      ...run,
      trust_verdict: "trusted",
      verdict_reasons: ["all_required_evidence_passed"],
    };
    const trustedDetail = {
      ...detail,
      run: trustedRun,
      review: {
        ...detail.review,
        trust_verdict: "trusted",
        interpretation: { summary: "Market Lab trusts this review for future alert consideration." },
        codex_review: null,
        portfolio_context: {
          status: "unavailable",
          source: "schwab",
          generated_at: "2026-05-11T00:01:00Z",
          accounts: [],
          positions: [],
          exposure_notes: [],
          overlap_notes: [],
          message: "No cached Schwab portfolio snapshot yet.",
        },
      },
    };
    const latestPortfolio = {
      status: "available",
      source: "schwab",
      generated_at: "2026-05-11T00:03:00Z",
      accounts: [{ account_hash: "acct-1", display_name: "Brokerage" }],
      positions: [
        {
          symbol: "AAPL",
          quantity: 25,
          average_price: 100,
          current_price: 125,
          day_change: 1.25,
          day_change_pct: 1,
          market_value: 3125,
        },
      ],
      exposure_notes: ["1 positions across 1 account(s)."],
      overlap_notes: ["AAPL is already owned; current market value $3,125.00."],
    };

    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/portfolio/latest")) {
        return Response.json({ status: "ok", data: latestPortfolio });
      }
      if (String(url).includes("/events")) {
        return Response.json({ status: "ok", data: [{ event: "done", message: "Run done", timestamp: "2026-05-11T00:02:00Z" }] });
      }
      if (String(url).includes("/api/market-lab/runs/") && !init?.method) {
        return Response.json({ status: "ok", data: trustedDetail });
      }
      return Response.json({ status: "ok", data: { runs: [trustedRun] } });
    }));

    render(<MarketLabClient />);

    expect(await screen.findByText("Evidence gates passed. Codex second opinion has not been attached yet.")).toBeInTheDocument();
    expect(await screen.findByText("Codex review not attached")).toBeInTheDocument();
    expect(screen.getByText("AVAILABLE · LATEST CACHE")).toBeInTheDocument();
    expect(screen.getByText(/AAPL owned/)).toBeInTheDocument();
    expect(screen.queryByText("Using latest Schwab cache because this run saved an unavailable portfolio snapshot.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /expand schwab portfolio/i }));
    expect(screen.getByText("owned")).toBeInTheDocument();
    expect(screen.getByText("Using latest Schwab cache because this run saved an unavailable portfolio snapshot.")).toBeInTheDocument();
    expect(screen.queryByText("Market Lab trusts this review for future alert consideration.")).toBeNull();
  });

  it("reports early settlement in operator language", async () => {
    render(<MarketLabClient />);

    await screen.findByText("Blocked because price data is stale.");
    fireEvent.click(screen.getByRole("button", { name: /^settle$/i }));

    expect(await screen.findByText("No settlement windows are due yet. 1D, 5D, 20D still waiting.")).toBeInTheDocument();
  });

  it("runs settle-due from the UI", async () => {
    render(<MarketLabClient />);

    await screen.findByText("Blocked because price data is stale.");
    fireEvent.click(screen.getByRole("button", { name: /settle due/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/market-lab/settle-due",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(await screen.findByText("Settle due updated 1 run.")).toBeInTheDocument();
  });

  it("starts a Codex-assisted review for the selected run", async () => {
    const pendingRun = {
      ...run,
      trust_verdict: "trusted",
      verdict_reasons: ["all_required_evidence_passed"],
    };
    const pendingDetail = {
      ...detail,
      run: pendingRun,
      review: {
        ...detail.review,
        trust_verdict: "trusted",
        verdict_reasons: ["all_required_evidence_passed"],
        interpretation: { summary: "Market Lab trusts this review for future alert consideration." },
        codex_review: null,
        artifact_paths: {
          ...detail.review.artifact_paths,
          codex_review: null,
        },
        checks: [{ code: "price_present", severity: "info", message: "Fresh price present." }],
      },
    };
    let streamStarted = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/codex-review") && init?.method === "POST") {
        return Response.json(
          { status: "ok", data: { status: "running", streamId: "stream-1", packet_path: "/tmp/codex-review-packet.md" } },
          { status: 202 },
        );
      }
      if (String(url).includes("/codex-review") && !init?.method) {
        return Response.json({ status: "ok", data: { status: "not_requested", packet_path: "/tmp/codex-review-packet.md" } });
      }
      if (String(url).includes("/api/codex/streams/stream-1")) {
        streamStarted = true;
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const send = (event: string, data: unknown) => {
              controller.enqueue(encoder.encode(`event: ${event}\n`));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            };
            send("lifecycle", { codexSessionId: "session-1" });
            send("codex_event", { type: "item.completed", item: { type: "agent_message" } });
            send("done", { session: { sessionId: "session-1" } });
            controller.close();
          },
        });
        return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      if (String(url).includes("/events")) {
        return Response.json({ status: "ok", data: [{ event: "done", message: "Run done", timestamp: "2026-05-11T00:02:00Z" }] });
      }
      if (String(url).includes("/api/market-lab/runs/") && !init?.method) {
        return Response.json({ status: "ok", data: streamStarted ? detail : pendingDetail });
      }
      return Response.json({ status: "ok", data: { runs: [pendingRun] } });
    }));

    render(<MarketLabClient />);

    const askButton = await screen.findByRole("button", { name: /ask codex/i });
    await waitFor(() => expect(askButton).not.toBeDisabled());
    fireEvent.click(askButton);
    fireEvent.click(askButton);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/market-lab/runs/mlab_test_AAPL/codex-review",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const codexPosts = vi
      .mocked(fetch)
      .mock.calls.filter(([url, init]) => String(url).includes("/codex-review") && init?.method === "POST");
    expect(codexPosts).toHaveLength(1);
    expect(await screen.findByText("Codex review attached. The review panel is up to date.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open session/i })).toHaveAttribute("href", "/sessions?sessionId=session-1");
  });

  it("keeps Ask Codex disabled after refresh when a review was already requested", async () => {
    const pendingRun = {
      ...run,
      trust_verdict: "trusted",
      verdict_reasons: ["all_required_evidence_passed"],
    };
    const pendingDetail = {
      ...detail,
      run: pendingRun,
      review: {
        ...detail.review,
        trust_verdict: "trusted",
        verdict_reasons: ["all_required_evidence_passed"],
        interpretation: { summary: "Market Lab trusts this review for future alert consideration." },
        codex_review: null,
        artifact_paths: {
          ...detail.review.artifact_paths,
          codex_review: null,
        },
        checks: [{ code: "price_present", severity: "info", message: "Fresh price present." }],
      },
    };

    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/codex-review") && init?.method === "POST") {
        return Response.json({ status: "error", error: "duplicate codex request" }, { status: 409 });
      }
      if (String(url).includes("/codex-review") && !init?.method) {
        return Response.json({
          status: "ok",
          data: {
            status: "already_requested",
            streamId: "stream-existing",
            sessionId: "session-existing",
            packet_path: "/tmp/codex-review-packet.md",
            reused: true,
          },
        });
      }
      if (String(url).includes("/events")) {
        return Response.json({ status: "ok", data: [{ event: "done", message: "Run done", timestamp: "2026-05-11T00:02:00Z" }] });
      }
      if (String(url).includes("/api/market-lab/runs/") && !init?.method) {
        return Response.json({ status: "ok", data: pendingDetail });
      }
      return Response.json({ status: "ok", data: { runs: [pendingRun] } });
    }));

    render(<MarketLabClient />);

    expect(await screen.findByText("Codex review was already requested. Waiting for Codex to attach the review artifact.")).toBeInTheDocument();
    const askButton = screen.getByRole("button", { name: /ask codex/i });
    expect(askButton).toBeDisabled();
    fireEvent.click(askButton);
    expect(screen.getByRole("link", { name: /open session/i })).toHaveAttribute("href", "/sessions?sessionId=session-existing");
    const codexPosts = vi
      .mocked(fetch)
      .mock.calls.filter(([url, init]) => String(url).includes("/codex-review") && init?.method === "POST");
    expect(codexPosts).toHaveLength(0);
  });

  it("refreshes the review artifact when the Codex transcript is not indexed", async () => {
    const pendingDetail = {
      ...detail,
      review: {
        ...detail.review,
        codex_review: null,
        artifact_paths: {
          ...detail.review.artifact_paths,
          codex_review: null,
        },
      },
    };
    let streamStarted = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/codex-review") && init?.method === "POST") {
        return Response.json(
          { status: "ok", data: { status: "running", streamId: "stream-error", packet_path: "/tmp/codex-review-packet.md" } },
          { status: 202 },
        );
      }
      if (String(url).includes("/codex-review") && !init?.method) {
        return Response.json({ status: "ok", data: { status: "not_requested", packet_path: "/tmp/codex-review-packet.md" } });
      }
      if (String(url).includes("/api/codex/streams/stream-error")) {
        streamStarted = true;
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode("event: error\n"));
            controller.enqueue(encoder.encode('data: {"error":"Codex session transcript did not index"}\n\n'));
            controller.close();
          },
        });
        return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      if (String(url).includes("/events")) {
        return Response.json({ status: "ok", data: [{ event: "codex_review_attached", message: "Codex review attached", timestamp: "2026-05-11T00:03:00Z" }] });
      }
      if (String(url).includes("/api/market-lab/runs/") && !init?.method) {
        return Response.json({ status: "ok", data: streamStarted ? detail : pendingDetail });
      }
      return Response.json({ status: "ok", data: { runs: [run] } });
    }));

    render(<MarketLabClient />);

    await screen.findByText("Blocked because price data is stale.");
    fireEvent.click(await screen.findByRole("button", { name: /ask codex/i }));

    expect(await screen.findByText("Codex review attached. Session transcript is not indexed yet, so use the review panel for now.")).toBeInTheDocument();
  });

  it("derives sentiment counts from Bullish:/Bearish: prefixed samples and filters the feed", async () => {
    const sentimentDetail = {
      ...detail,
      review: {
        ...detail.review,
        sentiment_snapshot: {
          status: "available",
          missing_sources: [],
          sources: [
            {
              source: "stocktwits",
              status: "available",
              sample_count: 3,
              fetch_method: "stocktwits_public_stream",
              samples: [
                "Bullish: $AAPL breakout setup",
                "Bullish: $AAPL strong earnings tailwind",
                "Bearish: $AAPL valuation stretched",
              ],
            },
            {
              source: "yahoo_finance_news",
              status: "available",
              sample_count: 1,
              fetch_method: "yahoo_finance_rss",
              samples: ["Apple announces new product line"],
            },
          ],
        },
      },
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/events")) {
        return Response.json({ status: "ok", data: [] });
      }
      if (String(url).includes("/api/market-lab/runs/") && !init?.method) {
        return Response.json({ status: "ok", data: sentimentDetail });
      }
      return Response.json({ status: "ok", data: { runs: [run] } });
    }));

    render(<MarketLabClient />);
    await screen.findByText("$AAPL breakout setup");

    // Summary bar: 2 bull / 1 bear of 3 labeled → 67% / 33%. 1 unlabeled.
    expect(screen.getByText("Bull 67%")).toBeInTheDocument();
    expect(screen.getByText("Bear 33%")).toBeInTheDocument();
    expect(screen.getByText("+1 unlabeled")).toBeInTheDocument();

    // Sentiment prefixes are stripped from the rendered headline.
    expect(screen.queryByText(/^Bullish: \$AAPL breakout setup$/)).toBeNull();

    // Filter to Bull only — the unlabeled Yahoo headline disappears.
    fireEvent.click(screen.getByRole("button", { name: /^bull$/i }));
    expect(screen.queryByText("Apple announces new product line")).toBeNull();
    expect(screen.getByText("$AAPL breakout setup")).toBeInTheDocument();
  });

  it("renders inside a parent dashboard without page chrome", async () => {
    render(<MarketLabClient embedded />);

    await screen.findByText("Blocked because price data is stale.");

    expect(screen.getByText("Forward-looking trust reviews")).toBeInTheDocument();
  });
});
