import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  computeFourHourChanges,
  computeThemePersistence,
  persistHistory,
  pruneHistory,
} from "../history.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("history", () => {
  it("derives 4h changes from prior snapshots", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "market-intel-history-"));
    tempDirs.push(dir);
    await writeFile(
      path.join(dir, "2026-03-13T08-00-00-000Z.json"),
      JSON.stringify({
        generatedAt: "2026-03-13T08:00:00.000Z",
        markets: [{ marketId: "mkt-1", slug: "fed-cut-june", probability: 0.57 }],
      }),
      "utf8",
    );

    const changes = await computeFourHourChanges({
      historyDir: dir,
      now: new Date("2026-03-13T12:00:00.000Z"),
      markets: [{ marketId: "mkt-1", probability: 0.64 }] as never,
    });

    expect(changes.get("mkt-1")).toBe(0.07);
  });

  it("degrades to null 4h changes when history files are corrupt", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "market-intel-history-bad-"));
    tempDirs.push(dir);
    await writeFile(path.join(dir, "bad.json"), "{not-json", "utf8");

    const changes = await computeFourHourChanges({
      historyDir: dir,
      now: new Date("2026-03-13T12:00:00.000Z"),
      markets: [{ marketId: "mkt-1", probability: 0.64 }] as never,
    });

    expect(changes.get("mkt-1")).toBeNull();
  });

  it("prunes old history files by age and snapshot count", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "market-intel-history-prune-"));
    tempDirs.push(dir);

    await writeFile(
      path.join(dir, "2026-03-10T08-00-00-000Z.json"),
      JSON.stringify({
        generatedAt: "2026-03-10T08:00:00.000Z",
        markets: [],
      }),
      "utf8",
    );
    await writeFile(
      path.join(dir, "2026-03-13T10-00-00-000Z.json"),
      JSON.stringify({
        generatedAt: "2026-03-13T10:00:00.000Z",
        markets: [],
      }),
      "utf8",
    );
    await writeFile(
      path.join(dir, "2026-03-13T11-00-00-000Z.json"),
      JSON.stringify({
        generatedAt: "2026-03-13T11:00:00.000Z",
        markets: [],
      }),
      "utf8",
    );

    const result = await pruneHistory(dir, {
      now: new Date("2026-03-13T12:00:00.000Z"),
      maxAgeDays: 1,
      maxSnapshots: 1,
    });

    expect(result.deletedFiles).toEqual([
      "2026-03-10T08-00-00-000Z.json",
      "2026-03-13T10-00-00-000Z.json",
    ]);
    expect(await readdir(dir)).toEqual(["2026-03-13T11-00-00-000Z.json"]);
  });

  it("persists history and applies default pruning bounds", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "market-intel-history-persist-"));
    tempDirs.push(dir);
    const latestPath = path.join(dir, "latest.json");
    const historyDir = path.join(dir, "history");

    await persistHistory({
      latestPath,
      historyDir,
      generatedAt: "2026-03-13T12:00:00.000Z",
      markets: [
        {
          marketId: "mkt-1",
          slug: "fed-cut-june",
          probability: 0.64,
        },
      ] as never,
      maxSnapshots: 5,
      maxAgeDays: 10,
    });

    const files = await readdir(historyDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("2026-03-13T12-00-00-000Z.json");
  });

  it("classifies persistent themes from local run history", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "market-intel-history-persistence-"));
    tempDirs.push(dir);

    await writeFile(
      path.join(dir, "2026-03-13T08-00-00-000Z.json"),
      JSON.stringify({
        generatedAt: "2026-03-13T08:00:00.000Z",
        markets: [{ marketId: "mkt-1", registryEntryId: "fed-easing", slug: "fed-cut-june", probability: 0.53 }],
      }),
      "utf8",
    );
    await writeFile(
      path.join(dir, "2026-03-13T10-00-00-000Z.json"),
      JSON.stringify({
        generatedAt: "2026-03-13T10:00:00.000Z",
        markets: [{ marketId: "mkt-1", registryEntryId: "fed-easing", slug: "fed-cut-june", probability: 0.58 }],
      }),
      "utf8",
    );
    await writeFile(
      path.join(dir, "2026-03-13T11-00-00-000Z.json"),
      JSON.stringify({
        generatedAt: "2026-03-13T11:00:00.000Z",
        markets: [{ marketId: "mkt-1", registryEntryId: "fed-easing", slug: "fed-cut-june", probability: 0.62 }],
      }),
      "utf8",
    );

    const persistence = await computeThemePersistence({
      historyDir: dir,
      now: new Date("2026-03-13T12:00:00.000Z"),
      markets: [{ marketId: "mkt-1", registryEntryId: "fed-easing", probability: 0.67 }] as never,
    });

    expect(persistence.get("mkt-1")?.state).toBe("accelerating");
    expect(persistence.get("mkt-1")?.latestPriorProbability).toBe(0.62);
  });
});
