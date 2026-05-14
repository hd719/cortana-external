"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useAutonomy } from "@/hooks/dashboard/use-autonomy";
import { useDbStatus } from "@/hooks/dashboard/use-db-status";
import { useHeartbeat, type HeartbeatStatus } from "@/hooks/dashboard/use-heartbeat";
import { useThinking } from "@/hooks/dashboard/use-thinking";
import { CollapsibleCard } from "./collapsible-card";

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

function DetailRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border/30 py-1 last:border-b-0">
      <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 truncate text-right text-[11px] font-medium", valueClass)}>{value}</span>
    </div>
  );
}

export function StatusStrip() {
  const heartbeat = useHeartbeat();
  const thinking = useThinking();
  const db = useDbStatus();
  const autonomy = useAutonomy();

  const hbStatus = heartbeat.data?.status ?? "unknown";
  const hbAge = heartbeatAge(heartbeat.data?.ageMs ?? null);
  const hbExact = heartbeat.data?.lastHeartbeat
    ? new Date(heartbeat.data.lastHeartbeat).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : null;

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
  const dbDetailValue =
    dbStatus === "loading"
      ? "loading…"
      : `Postgres ${pg ? "✓" : "✕"} · Vector ${lance ? "✓" : "✕"}`;

  const autonomyScore = autonomy.data?.source === "fallback" ? null : autonomy.data?.score ?? null;
  const autonomyTrend = autonomy.data?.trend?.direction ?? "flat";
  const trendArrow = autonomyTrend === "up" ? "↑" : autonomyTrend === "down" ? "↓" : "→";
  const trendToneClass =
    autonomyTrend === "up"
      ? "text-emerald-500"
      : autonomyTrend === "down"
        ? "text-rose-500"
        : "text-muted-foreground";
  const autonomyDelta = autonomy.data?.trend?.delta ?? 0;
  const autonomyDeltaLabel =
    autonomyDelta === 0 ? "0" : `${autonomyDelta > 0 ? "+" : ""}${autonomyDelta.toFixed(1)}`;

  return (
    <CollapsibleCard
      summary={
        <div className="flex min-w-0 items-center gap-x-2 overflow-hidden text-[12px]">
          <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", heartbeatDotClass[hbStatus])} />
          <span className="shrink-0 font-semibold">{heartbeatLabel[hbStatus]}</span>
          <span className="shrink-0 text-muted-foreground">{hbAge}</span>
          <span className="shrink-0 text-muted-foreground/40">·</span>
          <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", thinkingIdle ? "bg-sky-500" : "bg-emerald-500 animate-pulse")} />
          <span className="min-w-0 truncate text-muted-foreground" title={thinkingText}>{thinkingText}</span>
          <span className="shrink-0 text-muted-foreground/40">·</span>
          <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", dbDotClass)} />
          <span className="shrink-0 font-medium">PG</span>
          <span className="shrink-0 font-medium">Vector</span>
          <span className="shrink-0 text-muted-foreground/40">·</span>
          <span className="shrink-0 font-semibold tabular-nums">{autonomyScore ?? "—"}</span>
          <span className={cn("shrink-0 font-semibold", trendToneClass)}>{trendArrow}</span>
        </div>
      }
    >
      <div className="text-[11px]">
        <DetailRow
          label="Heartbeat"
          value={
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("inline-block h-1.5 w-1.5 rounded-full", heartbeatDotClass[hbStatus])} />
              {heartbeatLabel[hbStatus]} · {hbAge}
              {hbExact ? <span className="text-muted-foreground"> · {hbExact}</span> : null}
            </span>
          }
        />
        <DetailRow
          label="Processing"
          value={
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("inline-block h-1.5 w-1.5 rounded-full", thinkingIdle ? "bg-sky-500" : "bg-emerald-500")} />
              <span className="truncate">{thinkingText}</span>
            </span>
          }
        />
        <DetailRow
          label="Databases"
          value={
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("inline-block h-1.5 w-1.5 rounded-full", dbDotClass)} />
              {dbDetailValue}
            </span>
          }
          valueClass={dbStatus === "down" || dbStatus === "partial" ? "text-amber-600 dark:text-amber-400" : undefined}
        />
        <DetailRow
          label="Autonomy"
          value={
            <span>
              <span className="font-mono tabular-nums">{autonomyScore ?? "—"}</span>
              <span className={cn("ml-1 font-semibold", trendToneClass)}>{trendArrow}</span>
              <span className="ml-1 text-muted-foreground">{autonomyDeltaLabel}</span>
            </span>
          }
        />
        <Link
          href="/services"
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
        >
          Open services ↗
        </Link>
      </div>
    </CollapsibleCard>
  );
}
