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

    expect(screen.getAllByText("blocked").length).toBeGreaterThan(0);
    expect(screen.getByText("Current: done")).toBeInTheDocument();
    expect(screen.getByText("Run done")).toBeInTheDocument();
    expect(screen.getByText("Yahoo news")).toBeInTheDocument();
    expect(screen.getByText("News analysis")).toBeInTheDocument();
    expect(screen.getAllByText("News is not decisive.").length).toBeGreaterThan(0);
    expect(screen.getByText(/Missing: news/)).toBeInTheDocument();
    expect(screen.getByText("AAPL headline sample")).toBeInTheDocument();
    expect(screen.getByText("Codex says keep this blocked.")).toBeInTheDocument();
    expect(screen.getByText("Price action")).toBeInTheDocument();
    expect(screen.getByText("Price evidence is stale, so the review is blocked before analyst debate.")).toBeInTheDocument();
    expect(screen.getByText("/tmp/review.json")).toBeInTheDocument();
    expect(screen.getByText("/tmp/codex-review-packet.md")).toBeInTheDocument();
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
    render(<MarketLabClient />);

    await screen.findByText("Blocked because price data is stale.");
    fireEvent.click(await screen.findByRole("button", { name: /ask codex/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/market-lab/runs/mlab_test_AAPL/codex-review",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(await screen.findByText(/Codex review started in Sessions: stream-1/)).toBeInTheDocument();
  });

  it("renders inside a parent dashboard without page chrome", async () => {
    render(<MarketLabClient embedded />);

    await screen.findByText("Blocked because price data is stale.");

    expect(screen.getByText("Forward-looking trust reviews")).toBeInTheDocument();
  });
});
