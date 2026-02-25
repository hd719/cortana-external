"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type TrendDirection = "up" | "down" | "flat";

type AutonomyPayload = {
  ok: boolean;
  score: number;
  trend: {
    direction: TrendDirection;
    delta: number;
  };
  updatedAt: string;
  source: string;
};

const POLL_MS = 45_000;
const SIZE = 152;
const STROKE = 12;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const trendMeta: Record<TrendDirection, { arrow: string; tone: string; label: string }> = {
  up: { arrow: "↑", tone: "text-emerald-400", label: "Rising" },
  down: { arrow: "↓", tone: "text-rose-400", label: "Falling" },
  flat: { arrow: "→", tone: "text-slate-300", label: "Stable" },
};

export function AutonomyGauge() {
  const [payload, setPayload] = useState<AutonomyPayload>({
    ok: true,
    score: 0,
    trend: { direction: "flat", delta: 0 },
    updatedAt: new Date().toISOString(),
    source: "fallback",
  });

  const fetchAutonomy = useCallback(async () => {
    try {
      const res = await fetch("/api/autonomy-score", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as AutonomyPayload;
      if (typeof data.score === "number") {
        setPayload(data);
      }
    } catch {
      // Keep previous state when polling hiccups.
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(fetchAutonomy, 40);
    const interval = window.setInterval(fetchAutonomy, POLL_MS);

    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [fetchAutonomy]);

  const score = Math.max(0, Math.min(100, Math.round(payload.score)));
  const progress = useMemo(() => score / 100, [score]);
  const dashOffset = CIRCUMFERENCE * (1 - progress);

  const trend = trendMeta[payload.trend.direction];
  const deltaLabel =
    payload.trend.delta === 0 ? "0" : `${payload.trend.delta > 0 ? "+" : ""}${payload.trend.delta.toFixed(1)}`;

  return (
    <Card className="relative overflow-hidden border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 via-background to-background">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          Autonomy Score
          <Badge variant="outline" className="border-cyan-500/40 text-cyan-300">
            live
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div className="relative shrink-0">
          <svg width={SIZE} height={SIZE} className="rotate-[-90deg]">
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              stroke="rgba(148, 163, 184, 0.2)"
              strokeWidth={STROKE}
              fill="none"
            />
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              stroke="url(#autonomyGaugeStroke)"
              strokeWidth={STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              className="transition-[stroke-dashoffset] duration-700 ease-out"
            />
            <defs>
              <linearGradient id="autonomyGaugeStroke" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#06b6d4" />
                <stop offset="100%" stopColor="#22d3ee" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <p className="text-3xl font-semibold tracking-tight text-cyan-200">{score}</p>
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">/100</p>
            </div>
          </div>
          <span className="pointer-events-none absolute inset-4 rounded-full border border-cyan-300/20 gauge-pulse" />
        </div>

        <div className="min-w-0 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className={`text-lg ${trend.tone}`}>{trend.arrow}</span>
            <span className="font-medium text-foreground">{trend.label}</span>
            <span className={`text-xs ${trend.tone}`}>{deltaLabel}</span>
          </div>
          <p className="text-xs text-muted-foreground">Composite autonomy scorecard trend signal.</p>
          <p className="text-[11px] text-muted-foreground">
            Updated {new Date(payload.updatedAt).toLocaleTimeString()} · {payload.source}
          </p>
        </div>
      </CardContent>

      <style jsx>{`
        .gauge-pulse {
          animation: gaugePulse 2.6s ease-in-out infinite;
        }

        @keyframes gaugePulse {
          0%,
          100% {
            opacity: 0.25;
            transform: scale(0.98);
          }
          50% {
            opacity: 0.7;
            transform: scale(1.02);
          }
        }
      `}</style>
    </Card>
  );
}
