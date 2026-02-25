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
const SIZE = 64;
const STROKE = 6;
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
    <div className="flex h-full flex-col justify-center rounded-lg border border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 via-background to-background px-3 py-2 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <svg width={SIZE} height={SIZE} className="rotate-[-90deg]">
            <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} stroke="rgba(148, 163, 184, 0.2)" strokeWidth={STROKE} fill="none" />
            <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} stroke="url(#autonomyGaugeStroke)" strokeWidth={STROKE} fill="none" strokeLinecap="round" strokeDasharray={CIRCUMFERENCE} strokeDashoffset={dashOffset} className="transition-[stroke-dashoffset] duration-700 ease-out" />
            <defs>
              <linearGradient id="autonomyGaugeStroke" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#06b6d4" />
                <stop offset="100%" stopColor="#22d3ee" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <p className="text-sm font-semibold text-cyan-200">{score}</p>
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">Autonomy</p>
          <div className="flex items-center gap-1">
            <span className={`text-xs ${trend.tone}`}>{trend.arrow}</span>
            <span className="text-xs text-muted-foreground">{trend.label} {deltaLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
