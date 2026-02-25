"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, ShieldCheck, Activity, BrainCircuit } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type TodayStatsResponse = {
  source: "cortana" | "app";
  generatedAt: string;
  metrics: {
    subagentsSpawnedToday: number;
    tasksCompletedToday: number;
    selfHealsToday: number;
    activeRunsNow: number;
    decisionsLoggedToday: number;
  };
};

const POLL_MS = 45_000;

export function TodayStatsCard() {
  const [data, setData] = useState<TodayStatsResponse | null>(null);
  const [error, setError] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/today-stats", { cache: "no-store" });
      if (!res.ok) throw new Error("today-stats failed");
      const payload = (await res.json()) as TodayStatsResponse;
      setData(payload);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = window.setInterval(fetchStats, POLL_MS);
    return () => window.clearInterval(interval);
  }, [fetchStats]);

  const items = useMemo(() => {
    const metrics = data?.metrics;

    return [
      {
        key: "subagents",
        label: "Sub-agents spawned",
        value: metrics?.subagentsSpawnedToday ?? 0,
        icon: Bot,
        emphasizeOnNonZero: true,
      },
      {
        key: "tasks",
        label: "Tasks completed",
        value: metrics?.tasksCompletedToday ?? 0,
        icon: CheckCircle2,
        emphasizeOnNonZero: true,
      },
      {
        key: "selfHeals",
        label: "Self-heals triggered",
        value: metrics?.selfHealsToday ?? 0,
        icon: ShieldCheck,
        emphasizeOnNonZero: true,
      },
      {
        key: "runs",
        label: "Active runs now",
        value: metrics?.activeRunsNow ?? 0,
        icon: Activity,
        emphasizeOnNonZero: true,
      },
      {
        key: "decisions",
        label: "Decisions logged",
        value: metrics?.decisionsLoggedToday ?? 0,
        icon: BrainCircuit,
        emphasizeOnNonZero: false,
      },
    ];
  }, [data]);

  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          Today&apos;s stats
          <Badge variant="outline">refresh {POLL_MS / 1000}s</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {items.map((item) => {
            const Icon = item.icon;
            const highlight = item.emphasizeOnNonZero && item.value > 0;

            return (
              <div
                key={item.key}
                className={`rounded-lg border px-3 py-3 transition-colors ${
                  highlight
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : "border-border bg-card/50"
                }`}
              >
                <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                  <Icon className={`h-3.5 w-3.5 ${highlight ? "text-emerald-300" : ""}`} />
                  <span>{item.label}</span>
                </div>
                <p className={`text-2xl font-semibold tracking-tight ${highlight ? "text-emerald-200" : "text-foreground"}`}>
                  {item.value}
                </p>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {data ? `Updated ${new Date(data.generatedAt).toLocaleTimeString()}` : "Loading…"}
          </span>
          <span>{data ? `source: ${data.source} db` : ""}</span>
        </div>

        {error ? (
          <p className="text-xs text-amber-400">Stats temporarily unavailable. Retrying…</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
