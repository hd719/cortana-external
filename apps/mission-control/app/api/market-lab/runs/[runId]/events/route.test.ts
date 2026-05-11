import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { getMarketLabEvents } from "@/lib/market-lab";

vi.mock("@/lib/market-lab", () => ({
  getMarketLabEvents: vi.fn(),
}));

describe("Market Lab events route", () => {
  beforeEach(() => {
    vi.mocked(getMarketLabEvents).mockResolvedValue([
      { event: "queued", message: "Run queued" },
      { event: "done", message: "Run done" },
    ]);
  });

  it("returns event stream", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ runId: "mlab_test_AAPL" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data[1].event).toBe("done");
  });
});
