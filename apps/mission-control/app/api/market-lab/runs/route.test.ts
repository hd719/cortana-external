import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { listMarketLabRuns, startMarketLabRun } from "@/lib/market-lab";

vi.mock("@/lib/market-lab", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/market-lab")>();
  return {
    ...actual,
    listMarketLabRuns: vi.fn(),
    startMarketLabRun: vi.fn(),
  };
});

const sameOriginPost = (body: unknown) =>
  new Request("http://localhost/api/market-lab/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "localhost",
      origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });

describe("Market Lab runs route", () => {
  beforeEach(() => {
    vi.mocked(listMarketLabRuns).mockResolvedValue({ runs: [] });
    vi.mocked(startMarketLabRun).mockResolvedValue({
      run_id: "mlab_test_AAPL",
      symbol: "AAPL",
      status: "done",
      trust_verdict: "trusted",
      review_path: "/tmp/review.json",
    });
  });

  it("lists recent runs", async () => {
    const response = await GET(new Request("http://localhost/api/market-lab/runs"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.data.runs).toEqual([]);
  });

  it("rejects invalid symbols before spawning Python", async () => {
    const response = await POST(sameOriginPost({ symbol: "../../../etc/passwd" }));

    expect(response.status).toBe(400);
    expect(startMarketLabRun).not.toHaveBeenCalled();
  });

  it("starts a valid run", async () => {
    const response = await POST(sameOriginPost({ symbol: "aapl" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(startMarketLabRun).toHaveBeenCalledWith("AAPL");
    expect(body.data.run_id).toBe("mlab_test_AAPL");
  });
});
