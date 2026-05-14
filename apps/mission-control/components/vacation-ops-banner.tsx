"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight, Palmtree, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVacationOps } from "@/hooks/dashboard/use-vacation-ops";
import { VacationOpsCard } from "./vacation-ops-card";

function formatRelative(value: string | null | undefined): string {
  if (!value) return "never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  const ageMs = Math.max(0, Date.now() - parsed.getTime());
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hours}h ago` : `${hours}h ${rem}m ago`;
}

function formatClock(value: string): string {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatWindowLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const match = label.match(/(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return label;
  return `${match[2]}-${match[3]}`;
}

function modeLabel(mode: string | null | undefined): string {
  if (mode === "active") return "ACTIVE";
  if (mode === "ready") return "READY";
  if (mode === "prep") return "PREP";
  return "INACTIVE";
}

function readinessLabel(outcome: string | null | undefined): string {
  if (outcome === "pass") return "PASS";
  if (outcome === "warn") return "WARN";
  if (outcome === "no_go") return "NO-GO";
  if (outcome === "fail") return "FAIL";
  return "—";
}

function readinessToneClass(outcome: string | null | undefined): string {
  if (outcome === "pass") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  if (outcome === "warn") return "border-amber-400/60 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  if (outcome === "no_go" || outcome === "fail")
    return "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400";
  return "border-border/60 bg-muted/40 text-muted-foreground";
}

export function VacationOpsBanner() {
  const { data, error } = useVacationOps();
  const [expanded, setExpanded] = useState(false);

  const activeIncidents = data?.counts.activeIncidents ?? 0;
  const firstActiveIncident = (data?.recentIncidents ?? []).find((incident) => !incident.resolvedAt);

  if (expanded) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="inline-flex items-center gap-1 text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className="h-3 w-3" />
          Collapse vacation ops
        </button>
        <VacationOpsCard />
      </div>
    );
  }

  const readiness = data?.latestReadiness?.readinessOutcome;
  const readinessAge = formatRelative(data?.latestReadiness?.completedAt ?? data?.latestReadiness?.startedAt);
  const cadenceText = data
    ? `${formatClock(data.config.summaryTimes.morning)}–${formatClock(data.config.summaryTimes.evening)}`
    : "—";
  const window = data?.activeWindow ?? data?.latestWindow ?? null;
  const windowLabel = window
    ? `${formatWindowLabel(window.label) ?? "—"} → ${formatWindowLabel(window.endAt?.slice(0, 10) ?? null) ?? "—"}`
    : null;

  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      className="flex w-full items-center gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-2 text-left text-[12px] hover:bg-card/70"
    >
      <Palmtree className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="font-semibold uppercase tracking-wider">{modeLabel(data?.mode)}</span>
      <span
        className={cn(
          "rounded border px-1.5 py-px text-[10px] font-bold uppercase tracking-wider",
          readinessToneClass(readiness),
        )}
      >
        {readinessLabel(readiness)}
      </span>
      {activeIncidents > 0 ? (
        <span className="inline-flex min-w-0 items-center gap-1 text-red-600 dark:text-red-400">
          <ShieldAlert className="h-3 w-3 shrink-0" />
          <span className="shrink-0 font-semibold">
            {activeIncidents} incident{activeIncidents === 1 ? "" : "s"}
          </span>
          {firstActiveIncident ? (
            <span className="truncate text-muted-foreground">
              · {firstActiveIncident.systemLabel}
              {firstActiveIncident.symptom ? `: ${firstActiveIncident.symptom}` : ""}
            </span>
          ) : null}
        </span>
      ) : (
        <span className="text-muted-foreground">readiness {readinessAge}</span>
      )}
      <span className="hidden text-muted-foreground sm:inline">· cadence {cadenceText}</span>
      {windowLabel && activeIncidents === 0 ? (
        <span className="hidden text-muted-foreground md:inline">· {windowLabel}</span>
      ) : null}
      <Link
        href="/services?tab=vacation"
        onClick={(e) => e.stopPropagation()}
        className="ml-auto inline-flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        console ↗
      </Link>
      <ChevronRight className="h-3 w-3 text-muted-foreground" />
      {error ? <span className="ml-2 text-[10px] text-amber-500">offline</span> : null}
    </button>
  );
}
