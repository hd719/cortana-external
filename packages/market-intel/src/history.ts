import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  HistoryPruneResult,
  HistorySnapshotRecord,
  NormalizedMarketSnapshot,
  ThemePersistenceAssessment,
} from "./types.js";

export async function computeFourHourChanges(args: {
  historyDir: string;
  now: Date;
  markets: Array<Pick<NormalizedMarketSnapshot, "marketId" | "probability">>;
}): Promise<Map<string, number | null>> {
  const history = await loadHistory(args.historyDir);
  const targetTime = args.now.getTime() - 4 * 60 * 60 * 1000;
  const candidate = history
    .map((record) => ({
      record,
      distance: Math.abs(new Date(record.generatedAt).getTime() - targetTime),
    }))
    .sort((left, right) => left.distance - right.distance)[0]?.record;

  const result = new Map<string, number | null>();
  if (!candidate) {
    for (const market of args.markets) result.set(market.marketId, null);
    return result;
  }

  const prior = new Map(candidate.markets.map((market) => [market.marketId, market.probability]));
  for (const market of args.markets) {
    const previous = prior.get(market.marketId);
    result.set(market.marketId, previous == null ? null : round(market.probability - previous, 4));
  }

  return result;
}

export async function persistHistory(args: {
  latestPath: string;
  historyDir: string;
  generatedAt: string;
  markets: NormalizedMarketSnapshot[];
  maxSnapshots?: number;
  maxAgeDays?: number;
}): Promise<void> {
  const payload: HistorySnapshotRecord = {
    generatedAt: args.generatedAt,
    markets: args.markets.map((market) => ({
      marketId: market.marketId,
      registryEntryId: market.registryEntryId,
      theme: market.theme,
      slug: market.slug,
      probability: market.probability,
    })),
  };

  await mkdir(path.dirname(args.latestPath), { recursive: true });
  await mkdir(args.historyDir, { recursive: true });

  await writeAtomicJson(args.latestPath, payload);
  const historyFile = path.join(args.historyDir, `${sanitizeTimestamp(args.generatedAt)}.json`);
  await writeAtomicJson(historyFile, payload);
  await pruneHistory(args.historyDir, {
    maxSnapshots: args.maxSnapshots,
    maxAgeDays: args.maxAgeDays,
    now: new Date(args.generatedAt),
  });
}

export async function computeThemePersistence(args: {
  historyDir: string;
  now: Date;
  markets: Array<Pick<NormalizedMarketSnapshot, "marketId" | "registryEntryId" | "probability">>;
}): Promise<Map<string, ThemePersistenceAssessment>> {
  const history = (await loadHistory(args.historyDir))
    .filter((record) => new Date(record.generatedAt).getTime() <= args.now.getTime())
    .sort(
      (left, right) =>
        new Date(left.generatedAt).getTime() - new Date(right.generatedAt).getTime(),
    );

  const result = new Map<string, ThemePersistenceAssessment>();

  for (const market of args.markets) {
    const previous = history
      .map((record) => {
        const matched = record.markets.find(
          (item) =>
            item.registryEntryId === market.registryEntryId || item.marketId === market.marketId,
        );
        return matched ? { probability: matched.probability, generatedAt: record.generatedAt } : null;
      })
      .filter((item): item is { probability: number; generatedAt: string } => item != null)
      .slice(-4);

    if (previous.length === 0) {
      result.set(market.marketId, {
        state: "one_off",
        score: 0.35,
        observedRuns: 1,
        summary: "No local run history yet.",
        latestPriorProbability: null,
      });
      continue;
    }

    const probabilities = [...previous.map((item) => item.probability), market.probability];
    const deltas = [];
    for (let index = 1; index < probabilities.length; index += 1) {
      deltas.push(round(probabilities[index]! - probabilities[index - 1]!, 4));
    }

    const significant = deltas.filter((delta) => Math.abs(delta) >= 0.015);
    const latestDelta = deltas.at(-1) ?? 0;
    const latestSign = Math.sign(latestDelta);
    const priorSignificant = significant.slice(0, -1);
    const sameDirectionCount = significant.filter((delta) => Math.sign(delta) === latestSign).length;
    const oppositeBefore = priorSignificant.some((delta) => Math.sign(delta) === -latestSign);

    let state: ThemePersistenceAssessment["state"] = "one_off";
    let score = 0.4;
    let summary = "Recent odds move looks isolated so far.";

    if (oppositeBefore && Math.abs(latestDelta) >= 0.02 && latestSign !== 0) {
      state = "reversing";
      score = 0.62;
      summary = "Theme direction has flipped relative to the recent run trend.";
    } else if (
      sameDirectionCount >= 3 &&
      Math.abs(latestDelta) >= Math.abs(significant.at(-2) ?? 0) &&
      Math.abs(latestDelta) >= 0.02
    ) {
      state = "accelerating";
      score = 0.88;
      summary = "Theme has kept moving in the same direction and is accelerating.";
    } else if (sameDirectionCount >= 2 && latestSign !== 0) {
      state = "persistent";
      score = 0.72;
      summary = "Theme has kept building across multiple local runs.";
    }

    result.set(market.marketId, {
      state,
      score,
      observedRuns: previous.length + 1,
      summary,
      latestPriorProbability: previous.at(-1)?.probability ?? null,
    });
  }

  return result;
}

export async function pruneHistory(
  historyDir: string,
  options: {
    maxSnapshots?: number;
    maxAgeDays?: number;
    now?: Date;
  } = {},
): Promise<HistoryPruneResult> {
  const maxSnapshots = options.maxSnapshots ?? 200;
  const maxAgeDays = options.maxAgeDays ?? 45;
  const now = options.now ?? new Date();

  try {
    const files = (await readdir(historyDir))
      .filter((file) => file.endsWith(".json"))
      .sort();

    const kept = [...files];
    const deleted = new Set<string>();
    const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;

    if (Number.isFinite(maxAgeDays) && maxAgeDays >= 0) {
      for (const file of files) {
        const filePath = path.join(historyDir, file);
        const parsed = await readHistoryRecord(filePath);
        const generatedAt = parsed ? new Date(parsed.generatedAt).getTime() : Number.NaN;
        if (!Number.isFinite(generatedAt) || generatedAt < cutoff) {
          await rm(filePath, { force: true });
          deleted.add(file);
        }
      }
    }

    const remaining = kept.filter((file) => !deleted.has(file)).sort();
    if (Number.isFinite(maxSnapshots) && maxSnapshots >= 0 && remaining.length > maxSnapshots) {
      const overflow = remaining.slice(0, remaining.length - maxSnapshots);
      for (const file of overflow) {
        await rm(path.join(historyDir, file), { force: true });
        deleted.add(file);
      }
    }

    const keptFiles = kept.filter((file) => !deleted.has(file)).sort();
    return {
      deletedFiles: Array.from(deleted).sort(),
      keptFiles,
    };
  } catch {
    return {
      deletedFiles: [],
      keptFiles: [],
    };
  }
}

async function loadHistory(historyDir: string): Promise<HistorySnapshotRecord[]> {
  try {
    const files = (await readdir(historyDir))
      .filter((file) => file.endsWith(".json"))
      .sort();
    const parsed = await Promise.all(
      files.map(async (file) =>
        JSON.parse(await readFile(path.join(historyDir, file), "utf8")) as HistorySnapshotRecord,
      ),
    );
    return parsed;
  } catch {
    return [];
  }
}

async function readHistoryRecord(filePath: string): Promise<HistorySnapshotRecord | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as HistorySnapshotRecord;
  } catch {
    return null;
  }
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

async function writeAtomicJson(filePath: string, payload: HistorySnapshotRecord): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  await rename(tempPath, filePath);
}
