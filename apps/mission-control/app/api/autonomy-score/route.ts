import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getTaskPrisma } from "@/lib/task-prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TrendDirection = "up" | "down" | "flat";

type AutonomyScoreResponse = {
  ok: boolean;
  score: number;
  trend: {
    direction: TrendDirection;
    delta: number;
  };
  updatedAt: string;
  source: "scorecard" | "self_model" | "fallback";
};

type ScoreEventRow = {
  timestamp: Date;
  metadata: unknown;
};

type SelfModelRow = {
  health_score: number | null;
  updated_at: Date | null;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const pick = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return null;
};

const deriveTrendDirection = (delta: number): TrendDirection => {
  if (delta > 0.35) return "up";
  if (delta < -0.35) return "down";
  return "flat";
};

const parseScoreEvent = (metadata: unknown) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;

  const payload = metadata as Record<string, unknown>;

  const score = toNumber(
    pick(payload, ["composite_score", "compositeScore", "score", "autonomy_score", "autonomyScore"])
  );

  if (score == null) return null;

  const delta =
    toNumber(pick(payload, ["trend_delta", "trendDelta", "delta", "change"])) ?? 0;

  const explicitTrend = pick(payload, ["trend", "trend_direction", "trendDirection"]);
  const direction =
    typeof explicitTrend === "string"
      ? explicitTrend.toLowerCase() === "up"
        ? "up"
        : explicitTrend.toLowerCase() === "down"
          ? "down"
          : "flat"
      : deriveTrendDirection(delta);

  return {
    score: clampScore(score),
    trend: {
      direction,
      delta: Number(delta.toFixed(2)),
    },
  };
};

export async function GET() {
  const taskPrisma = getTaskPrisma();
  const db = taskPrisma ?? prisma;

  const fallback: AutonomyScoreResponse = {
    ok: true,
    score: 0,
    trend: { direction: "flat", delta: 0 },
    updatedAt: new Date().toISOString(),
    source: "fallback",
  };

  try {
    const scoreRows = await db.$queryRaw<ScoreEventRow[]>`
      SELECT timestamp, metadata
      FROM cortana_events
      WHERE event_type IN ('autonomy_scorecard', 'autonomy.scorecard', 'autonomy_score')
         OR metadata ? 'composite_score'
         OR metadata ? 'compositeScore'
         OR metadata ? 'autonomy_score'
      ORDER BY timestamp DESC
      LIMIT 2
    `;

    const latest = scoreRows[0];
    const previous = scoreRows[1];

    if (latest) {
      const parsedLatest = parseScoreEvent(latest.metadata);
      if (parsedLatest) {
        if (previous) {
          const parsedPrevious = parseScoreEvent(previous.metadata);
          if (parsedPrevious) {
            const delta = Number((parsedLatest.score - parsedPrevious.score).toFixed(2));
            parsedLatest.trend = {
              direction: deriveTrendDirection(delta),
              delta,
            };
          }
        }

        return NextResponse.json(
          {
            ok: true,
            score: parsedLatest.score,
            trend: parsedLatest.trend,
            updatedAt: latest.timestamp.toISOString(),
            source: "scorecard",
          } satisfies AutonomyScoreResponse,
          {
            headers: {
              "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
            },
          }
        );
      }
    }

    const selfRows = await db.$queryRaw<SelfModelRow[]>`
      SELECT health_score, updated_at
      FROM cortana_self_model
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
    `;

    const self = selfRows[0];
    if (self?.health_score != null) {
      return NextResponse.json(
        {
          ok: true,
          score: clampScore(self.health_score),
          trend: { direction: "flat", delta: 0 },
          updatedAt: self.updated_at?.toISOString() ?? new Date().toISOString(),
          source: "self_model",
        } satisfies AutonomyScoreResponse,
        {
          headers: {
            "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          },
        }
      );
    }
  } catch {
    // fall through
  }

  return NextResponse.json(fallback, {
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
