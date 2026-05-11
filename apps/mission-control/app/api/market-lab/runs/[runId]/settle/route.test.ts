import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { settleMarketLabRun } from "@/lib/market-lab";

vi.mock("@/lib/market-lab", () => ({
  settleMarketLabRun: vi.fn(),
}));

const sameOriginPost = () =>
  new Request("http://localhost/api/market-lab/runs/mlab_test_AAPL/settle", {
    method: "POST",
    headers: {
      host: "localhost",
      origin: "http://localhost",
    },
  });

describe("Market Lab settle route", () => {
  beforeEach(() => {
    vi.mocked(settleMarketLabRun).mockResolvedValue({
      run_id: "mlab_test_AAPL",
      symbol: "AAPL",
      settlements: [{ window: "1d", status: "not_due" }],
    });
  });

  it("settles a run through the Python CLI bridge", async () => {
    const response = await POST(sameOriginPost(), {
      params: Promise.resolve({ runId: "mlab_test_AAPL" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(settleMarketLabRun).toHaveBeenCalledWith("mlab_test_AAPL");
    expect(body.data.settlements[0].window).toBe("1d");
  });
});
