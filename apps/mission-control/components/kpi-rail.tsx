"use client";

import Link from "next/link";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { formatDuration, formatPercent } from "@/lib/format-utils";
import { useMjolnirFitness } from "@/hooks/dashboard/use-mjolnir-fitness";
import { useReliabilitySlo } from "@/hooks/dashboard/use-reliability-slo";
import { useTodayStats } from "@/hooks/dashboard/use-today-stats";

function isSameDay(value: string, now: Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

const recoveryToneClass: Record<string, string> = {
  green: "text-emerald-600 dark:text-emerald-400",
  yellow: "text-amber-600 dark:text-amber-400",
  red: "text-red-600 dark:text-red-400",
  unknown: "text-muted-foreground",
};

const recoveryLabel: Record<string, string> = {
  green: "Green",
  yellow: "Yellow",
  red: "Red",
  unknown: "—",
};

function Stat({
  label,
  value,
  valueClass,
  highlight,
}: {
  label: string;
  value: string | number;
  valueClass?: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/30 px-3 py-1.5 last:border-b-0">
      <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className={cn("font-mono text-sm font-semibold tabular-nums", valueClass, highlight && "text-emerald-600 dark:text-emerald-400")}>
        {value}
      </span>
    </div>
  );
}

function Section({
  title,
  href,
  className,
  children,
}: {
  title: string;
  href?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const head = (
    <div className="flex items-center justify-between border-b border-border/40 bg-muted/20 px-3 py-1.5">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</span>
      {href ? <span className="text-[10px] text-muted-foreground/70 group-hover:text-foreground">↗</span> : null}
    </div>
  );

  const inner = (
    <div className={cn("flex flex-col overflow-hidden border-b border-border/40 last:border-b-0", className)}>
      {head}
      <div>{children}</div>
    </div>
  );

  return href ? (
    <Link href={href} className="group block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function KpiRail() {
  const today = useTodayStats();
  const mjolnir = useMjolnirFitness();
  const slo = useReliabilitySlo();

  const todayMetrics = today.data?.metrics;
  const todayLoaded = Boolean(today.data);

  const recovery = mjolnir.data?.recovery;
  const sleep = mjolnir.data?.sleep;
  const recoveryStatus = recovery?.status ?? "unknown";
  const todayWorkouts = useMemo(() => {
    if (!mjolnir.data?.workouts?.length) return 0;
    const now = new Date();
    return mjolnir.data.workouts.filter((w) => w.start && isSameDay(w.start, now)).length;
  }, [mjolnir.data]);
  const activeAlerts = mjolnir.data?.alerts?.length ?? 0;

  const sloMetrics = slo.data?.metrics;
  const formatPct = (v: number | undefined, n: number | undefined) =>
    !sloMetrics || (n ?? 0) === 0 ? "—" : `${v ?? 0}%`;

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border/60 bg-card/40 lg:h-full">
      <Section title="Today" href="/services">
        <Stat label="Sub-agents" value={todayLoaded ? todayMetrics?.subagentsSpawnedToday ?? 0 : "—"} highlight={(todayMetrics?.subagentsSpawnedToday ?? 0) > 0} />
        <Stat label="Tasks done" value={todayLoaded ? todayMetrics?.tasksCompletedToday ?? 0 : "—"} highlight={(todayMetrics?.tasksCompletedToday ?? 0) > 0} />
        <Stat label="Self-heals" value={todayLoaded ? todayMetrics?.selfHealsToday ?? 0 : "—"} highlight={(todayMetrics?.selfHealsToday ?? 0) > 0} />
        <Stat label="Active runs" value={todayLoaded ? todayMetrics?.activeRunsNow ?? 0 : "—"} highlight={(todayMetrics?.activeRunsNow ?? 0) > 0} />
      </Section>

      <Section title="Mjolnir" href="/mjolnir">
        <Stat
          label="Recovery"
          value={recovery?.score != null ? `${recovery.score} · ${recoveryLabel[recoveryStatus]}` : "—"}
          valueClass={recoveryToneClass[recoveryStatus]}
        />
        <Stat label="Sleep" value={sleep ? formatDuration(sleep.durationSeconds ?? null) : "—"} />
        <Stat label="Sleep perf" value={sleep ? formatPercent(sleep.performance ?? null) : "—"} />
        <Stat label="Workouts" value={mjolnir.data ? todayWorkouts : "—"} />
        <Stat
          label="Alerts"
          value={mjolnir.data ? (activeAlerts === 0 ? "All clear" : String(activeAlerts)) : "—"}
          valueClass={activeAlerts > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
        />
      </Section>

      <Section title="Reliability · 24h" href="/services">
        <Stat
          label="Cron on-time"
          value={formatPct(sloMetrics?.cronOnTimePct, sloMetrics?.samples.cronJobs)}
        />
        <Stat
          label="Aborted runs"
          value={formatPct(sloMetrics?.abortedRunRatePct, sloMetrics?.samples.terminalRuns)}
        />
        <Stat
          label="Delivery"
          value={formatPct(sloMetrics?.deliverySuccessPct, sloMetrics?.samples.deliveryRequiredJobs)}
        />
        <Stat
          label="P95 resp"
          value={
            !sloMetrics || sloMetrics.samples.responseSamples === 0
              ? "—"
              : `${Math.round(sloMetrics.p95ResponseMs)}ms`
          }
        />
        <Stat
          label="API 429"
          value={formatPct(sloMetrics?.api429RateByProvider?.[0]?.ratePct, sloMetrics?.samples.providerSamples)}
        />
      </Section>
    </div>
  );
}
