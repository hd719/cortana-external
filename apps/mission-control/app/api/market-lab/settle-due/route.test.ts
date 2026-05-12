import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { settleDueMarketLabRuns } from "@/lib/market-lab";

vi.mock("@/lib/market-lab", () => ({
  settleDueMarketLabRuns: vi.fn(),
}));

const sameOriginPost = () =>
  new Request("http://localhost/api/market-lab/settle-due", {
    method: "POST",
    headers: {
      host: "localhost",
      origin: "http://localhost",
    },
  });

describe("Market Lab settle-due route", () => {
  beforeEach(() => {
    vi.mocked(settleDueMarketLabRuns).mockResolvedValue({ settled_run_ids: ["mlab_test_AAPL"] });
  });

  it("settles all due Market Lab windows through the Python CLI bridge", async () => {
    const response = await POST(sameOriginPost());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(settleDueMarketLabRuns).toHaveBeenCalled();
    expect(body.data.settled_run_ids).toEqual(["mlab_test_AAPL"]);
  });
});
