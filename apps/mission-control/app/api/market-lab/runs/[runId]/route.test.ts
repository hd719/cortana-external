import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { getMarketLabRun } from "@/lib/market-lab";

vi.mock("@/lib/market-lab", () => ({
  getMarketLabRun: vi.fn(),
}));

describe("Market Lab run detail route", () => {
  beforeEach(() => {
    vi.mocked(getMarketLabRun).mockResolvedValue({
      run: {
        run_id: "mlab_test_AAPL",
        symbol: "AAPL",
        requested_at: "2026-05-11T00:00:00Z",
        status: "done",
        trust_verdict: "blocked",
        verdict_reasons: ["price_data_stale"],
        run_dir: "/tmp/run",
        events_path: "/tmp/events.jsonl",
        logs_path: "/tmp/logs.txt",
      },
      review: null,
      settlements: [],
    });
  });

  it("returns stable detail shape", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ runId: "mlab_test_AAPL" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.data.run.run_id).toBe("mlab_test_AAPL");
  });
});
