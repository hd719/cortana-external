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
    codex_review: { status: "attached", summary: "Codex says keep this blocked.", session_id: "session-1" },
    artifact_paths: {
      review: "/tmp/review.json",
      events: "/tmp/events.jsonl",
      logs: "/tmp/logs.txt",
      codex_packet: "/tmp/codex-review-packet.md",
      codex_review: "/tmp/codex-review.md",
    },
    checks: [{ code: "price_data_stale", severity: "blocker", message: "stale" }],
    settlements: [{ window: "1d", status: "pending" }],
  },
  settlements: [{ window: "1d", status: "pending" }],
};

describe("MarketLabClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/codex-review") && init?.method === "POST") {
        return Response.json(
          { status: "ok", data: { streamId: "stream-1", packet_path: "/tmp/codex-review-packet.md" } },
          { status: 202 },
        );
      }
      if (String(url).includes("/events")) {
        return Response.json({ status: "ok", data: [{ event: "done", message: "Run done" }] });
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
    expect(screen.getByText("Run done")).toBeInTheDocument();
    expect(screen.getByText("Codex says keep this blocked.")).toBeInTheDocument();
    expect(screen.getByText(/review: \/tmp\/review\.json/)).toBeInTheDocument();
    expect(screen.getByText(/codex packet: \/tmp\/codex-review-packet\.md/)).toBeInTheDocument();
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

  it("starts a Codex-assisted review for the selected run", async () => {
    render(<MarketLabClient />);

    fireEvent.click(await screen.findByRole("button", { name: /ask codex/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/market-lab/runs/mlab_test_AAPL/codex-review",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(await screen.findByText("Codex review started: stream-1")).toBeInTheDocument();
  });
});
