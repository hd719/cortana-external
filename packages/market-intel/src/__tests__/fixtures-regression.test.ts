import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildPolymarketIntelReport } from "../service.js";

const fixturePath = path.join(
  import.meta.dirname,
  "../__fixtures__/live-events-sample.json",
);

describe("fixture regression", () => {
  it("produces stable top-market semantics from saved live payloads", async () => {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as unknown;

    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.pathname === "/events") {
        return new Response(JSON.stringify(fixture), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname === "/markets") {
        const slug = url.searchParams.get("slug");
        const events = fixture as Array<{ markets?: Array<{ slug?: string }> }>;
        const market = events.flatMap((event) => event.markets ?? []).find((item) => item.slug === slug);
        return new Response(JSON.stringify(market ? [market] : []), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected path ${url.pathname}`);
    };

    const report = await buildPolymarketIntelReport({
      fetchImpl,
      maxMarkets: 4,
      now: new Date("2026-03-14T01:20:00.000Z"),
    });

    expect(report.topMarkets.map((market) => market.displayTitle)).toEqual(
      expect.arrayContaining([
        "Fed easing odds",
        "US recession odds",
        "Geopolitical escalation risk",
      ]),
    );
    const fed = report.topMarkets.find((market) => market.registryEntryId === "fed-easing");
    expect(fed?.probability).toBe(0.765);
  });
});
