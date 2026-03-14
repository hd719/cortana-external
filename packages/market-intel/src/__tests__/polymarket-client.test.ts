import { describe, expect, it, vi } from "vitest";

import { PolymarketClient } from "../polymarket-client.js";

describe("polymarket client", () => {
  it("retries transient failures before succeeding", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "1", slug: "test-market" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const client = new PolymarketClient({
      fetchImpl,
      retries: 1,
      timeoutMs: 1000,
    });

    const result = await client["request"]("/markets", { slug: "test-market" });

    expect(result).toEqual([{ id: "1", slug: "test-market" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
