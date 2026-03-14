import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadRegimeContext } from "../regime.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("regime loading", () => {
  it("loads the backtester cache shape", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "market-intel-regime-"));
    tempDirs.push(dir);
    const regimePath = path.join(dir, "regime.json");
    await writeFile(
      regimePath,
      JSON.stringify({
        generated_at_utc: "2026-03-13T12:00:00.000Z",
        market_status: {
          regime: "correction",
          status: "degraded",
          position_sizing: 0,
          notes: "Cached market snapshot",
          regime_score: -3,
          drawdown_pct: -8.1,
          recent_return_pct: -2.3,
        },
      }),
      "utf8",
    );

    const regime = await loadRegimeContext(regimePath);

    expect(regime?.regime).toBe("correction");
    expect(regime?.status).toBe("degraded");
  });

  it("returns null for invalid regime files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "market-intel-regime-bad-"));
    tempDirs.push(dir);
    const regimePath = path.join(dir, "regime.json");
    await writeFile(regimePath, JSON.stringify({ hello: "world" }), "utf8");

    const regime = await loadRegimeContext(regimePath);

    expect(regime).toBeNull();
  });
});
