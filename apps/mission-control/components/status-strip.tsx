"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useAutonomy } from "@/hooks/dashboard/use-autonomy";
import { useDbStatus } from "@/hooks/dashboard/use-db-status";
import { useHeartbeat, type HeartbeatStatus } from "@/hooks/dashboard/use-heartbeat";
import { useThinking } from "@/hooks/dashboard/use-thinking";

function heartbeatAge(ageMs: number | null): string {
  if (ageMs == null) return "—";
  const mins = Math.max(0, Math.floor(ageMs / 60_000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}

const heartbeatLabel: Record<HeartbeatStatus, string> = {
  healthy: "LIVE",
  stale: "STALE",
  missed: "MISSED",
  quiet: "QUIET",
  unknown: "—",
};

const heartbeatDotClass: Record<HeartbeatStatus, string> = {
  healthy: "bg-emerald-500",
  stale: "bg-amber-500",
  missed: "bg-red-500",
  quiet: "bg-sky-500",
  unknown: "bg-muted-foreground/40",
};

export function StatusStrip() {
  const heartbeat = useHeartbeat();
  const thinking = useThinking();
  const db = useDbStatus();
  const autonomy = useAutonomy();

  const hbStatus = heartbeat.data?.status ?? "unknown";
  const thinkingIdle = thinking.data?.idle ?? true;
  const thinkingText = thinking.data?.current ?? thinking.data?.items?.[0] ?? "Systems nominal.";

  const pg = db.data?.postgres;
  const lance = db.data?.lancedb;
  const dbStatus =
    pg === undefined || lance === undefined
      ? "loading"
      : pg && lance
        ? "ok"
        : pg || lance
          ? "partial"
          : "down";
  const dbDotClass =
    dbStatus === "ok"
      ? "bg-emerald-500"
      : dbStatus === "partial"
        ? "bg-amber-500"
        : dbStatus === "down"
          ? "bg-red-500"
          : "bg-muted-foreground/40";

  const autonomyScore = autonomy.data?.source === "fallback" ? null : autonomy.data?.score ?? null;
  const autonomyTrend = autonomy.data?.trend?.direction ?? "flat";
  const trendArrow = autonomyTrend === "up" ? "↑" : autonomyTrend === "down" ? "↓" : "→";
  const trendToneClass =
    autonomyTrend === "up"
      ? "text-emerald-500"
      : autonomyTrend === "down"
        ? "text-rose-500"
        : "text-muted-foreground";

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-border/60 bg-card/40 px-3 py-1.5 text-[12px]">
      <Link href="/services" className="inline-flex items-center gap-1.5 hover:underline">
        <span className={cn("inline-block h-2 w-2 rounded-full", heartbeatDotClass[hbStatus])} />
        <span className="font-semibold">{heartbeatLabel[hbStatus]}</span>
        <span className="text-muted-foreground">{heartbeatAge(heartbeat.data?.ageMs ?? null)}</span>
      </Link>

      <span className="text-muted-foreground/40">·</span>

      <Link href="/services" className="inline-flex items-center gap-1.5 hover:underline">
        <span className={cn("inline-block h-2 w-2 rounded-full", thinkingIdle ? "bg-sky-500" : "bg-emerald-500 animate-pulse")} />
        <span className="max-w-[18ch] truncate text-muted-foreground sm:max-w-[28ch]" title={thinkingText}>
          {thinkingText}
        </span>
      </Link>

      <span className="text-muted-foreground/40">·</span>

      <Link href="/services" className="inline-flex items-center gap-1.5 hover:underline">
        <span className={cn("inline-block h-2 w-2 rounded-full", dbDotClass)} />
        <span className="font-medium">PG</span>
        <span className="text-muted-foreground/60">·</span>
        <span className="font-medium">Vector</span>
      </Link>

      <span className="text-muted-foreground/40">·</span>

      <Link href="/services" className="inline-flex items-center gap-1.5 hover:underline">
        <span className="font-semibold tabular-nums">{autonomyScore ?? "—"}</span>
        <span className={cn("font-semibold", trendToneClass)}>{trendArrow}</span>
        <span className="text-muted-foreground">autonomy</span>
      </Link>
    </div>
  );
}
