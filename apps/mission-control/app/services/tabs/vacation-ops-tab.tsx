"use client";

import * as React from "react";
import {
  AlertTriangle,
  CalendarRange,
  Loader2,
  Palmtree,
  PlayCircle,
  Power,
  ShieldCheck,
  ShieldEllipsis,
  Siren,
  Timer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnimatedValue } from "@/components/mjolnir/animated-value";
import { cn } from "@/lib/utils";
import {
  type VacationCheck,
  type VacationIncident,
  type VacationOpsSnapshot,
  type VacationTierRollup,
} from "@/lib/vacation-ops";
import { EmptyState, RefreshButton, SectionCard, StatCard, TabLayout } from "./shared";

type VacationOpsResponse =
  | { status: "ok"; data: VacationOpsSnapshot }
  | { status: "error"; message: string };

type VacationOpsActionResponse =
  | { status: "ok"; action: string; result: Record<string, unknown>; data: VacationOpsSnapshot }
  | { status: "error"; message: string };

const POLL_MS = 45_000;
const HOUR_OPTIONS = Array.from({ length: 12 }, (_, index) => {
  const hour = String(index + 1);
  return { value: hour, label: hour };
});

const MINUTE_OPTIONS = [
  { value: "00", label: ":00" },
  { value: "15", label: ":15" },
  { value: "30", label: ":30" },
  { value: "45", label: ":45" },
];

const MERIDIEM_OPTIONS = [
  { value: "AM", label: "AM" },
  { value: "PM", label: "PM" },
];

const DEFAULT_PLANNER_PARTS: PlannerParts = {
  date: "",
  hour: "12",
  minute: "00",
  meridiem: "AM",
};

const RETIRED_TRADING_PROVIDER_KEYS = new Set(["alpaca", "fred", "backtester"]);

type ActionKey = "prep" | "enable" | "disable" | "unpause" | "cancel";

type PlannerParts = {
  date: string;
  hour: string;
  minute: string;
  meridiem: "AM" | "PM";
};

function normalizePlannerMinute(minute: number) {
  const allowed = [0, 15, 30, 45];
  const nearest = allowed.reduce((best, candidate) =>
    Math.abs(candidate - minute) < Math.abs(best - minute) ? candidate : best, allowed[0]);
  return String(nearest).padStart(2, "0");
}

function formatDateTime(value: string | null | undefined, timezone?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(parsed);
}

function formatToastDate(value: string, timezone?: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(parsed);
}

function formatRelative(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  const ageMs = Math.max(0, Date.now() - parsed.getTime());
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  const remainder = mins % 60;
  if (hours < 48) return remainder === 0 ? `${hours}h ago` : `${hours}h ${remainder}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatClock(value: string) {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatCadence(summaryTimes: VacationOpsSnapshot["config"]["summaryTimes"]) {
  return `${formatClock(summaryTimes.morning)} · ${formatClock(summaryTimes.evening)}`;
}

function formatWindowLabel(label: string | null | undefined) {
  if (!label) return "—";
  const match = label.match(/(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return label;
  return `${match[2]}-${match[3]}-${match[1]}`;
}

function toPlannerParts(value: string): PlannerParts {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { ...DEFAULT_PLANNER_PARTS };
  }
  const rawHour = parsed.getHours();
  const meridiem: "AM" | "PM" = rawHour >= 12 ? "PM" : "AM";
  const hour12 = rawHour % 12 === 0 ? 12 : rawHour % 12;
  return {
    date: `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`,
    hour: String(hour12),
    minute: normalizePlannerMinute(parsed.getMinutes()),
    meridiem,
  };
}

function fromPlannerParts(parts: PlannerParts) {
  if (!parts.date || !parts.hour || !parts.minute || !parts.meridiem) return "";
  const numericHour = Number(parts.hour);
  if (!Number.isFinite(numericHour) || numericHour < 1 || numericHour > 12) return "";
  const hour24 = parts.meridiem === "AM"
    ? (numericHour === 12 ? 0 : numericHour)
    : (numericHour === 12 ? 12 : numericHour + 12);
  const parsed = new Date(`${parts.date}T${String(hour24).padStart(2, "0")}:${parts.minute}:00`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function readinessBadge(outcome: string | null | undefined) {
  if (outcome === "pass") return "success" as const;
  if (outcome === "warn") return "warning" as const;
  if (outcome === "no_go" || outcome === "fail") return "destructive" as const;
  return "outline" as const;
}

function readinessTextClass(outcome: string | null | undefined) {
  if (outcome === "pass") return "text-emerald-600 dark:text-emerald-300";
  if (outcome === "warn") return "text-amber-600 dark:text-amber-300";
  if (outcome === "no_go" || outcome === "fail") return "text-red-600 dark:text-red-300";
  return "text-foreground";
}

function modeBadge(mode: string) {
  if (mode === "active") return "success" as const;
  if (mode === "ready") return "info" as const;
  if (mode === "prep") return "secondary" as const;
  return "outline" as const;
}

function checkBadge(status: string) {
  if (status === "green") return "success" as const;
  if (status === "yellow" || status === "warn") return "warning" as const;
  if (status === "red" || status === "fail") return "destructive" as const;
  if (status === "info") return "info" as const;
  return "outline" as const;
}

function summarizeDetail(detail: Record<string, unknown>) {
  const services = asArray<Record<string, unknown>>(detail.services)
    .filter((service) => !isRetiredTradingProvider(service))
    .map((service) => asString(service.label) ?? asString(service.key))
    .filter(Boolean);
  if (services.length > 0 && asString(detail.summary)?.match(/alpaca|fred|backtester/i)) {
    return `${services.join(", ")} readiness checked.`;
  }
  if (typeof detail.summary === "string" && detail.summary.trim().length > 0) {
    return detail.summary;
  }
  if (typeof detail.detail === "string" && detail.detail.trim().length > 0) {
    return detail.detail;
  }
  if (typeof detail.url === "string") return detail.url;
  if (typeof detail.jobName === "string") return detail.jobName;
  if (Array.isArray(detail.staleKeys) && detail.staleKeys.length > 0) return `Stale keys: ${detail.staleKeys.join(", ")}`;
  if (typeof detail.statusDetail === "string") return detail.statusDetail;
  const entries = Object.entries(detail)
    .slice(0, 3)
    .map(([key, currentValue]) => `${key}: ${typeof currentValue === "string" ? currentValue : JSON.stringify(currentValue)}`);
  return entries.join(" · ") || "No additional detail";
}

function asArray<T = Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function isRetiredTradingProvider(service: Record<string, unknown>) {
  const key = asString(service.key)?.toLowerCase();
  const label = asString(service.label)?.toLowerCase();
  return Boolean((key && RETIRED_TRADING_PROVIDER_KEYS.has(key)) || (label && RETIRED_TRADING_PROVIDER_KEYS.has(label)));
}

function formatBoolean(value: unknown) {
  if (typeof value !== "boolean") return "Unknown";
  return value ? "Yes" : "No";
}

function renderStructuredCheckDetail(check: VacationCheck) {
  if (check.systemKey === "github_identity") {
    const scopes = asArray<string>(check.detail.scopes).map((scope) => String(scope));
    return (
      <div className="mt-3 grid gap-3 rounded-lg border border-border/50 bg-muted/10 p-3 md:grid-cols-2">
        <StructuredField label="Host" value={asString(check.detail.host) ?? "Unknown"} />
        <StructuredField label="Account" value={asString(check.detail.account) ?? "Unknown"} />
        <StructuredField label="Active account" value={formatBoolean(check.detail.activeAccount)} />
        <StructuredField label="Git protocol" value={asString(check.detail.gitProtocol) ?? "Unknown"} />
        <StructuredField label="Config path" value={asString(check.detail.configPath) ?? "Unknown"} className="md:col-span-2" />
        <StructuredField label="Token" value={asString(check.detail.tokenRedacted) ?? "Unknown"} />
        <StructuredField
          label="Scopes"
          value={scopes.length > 0 ? scopes.join(", ") : "No scopes reported"}
          className="md:col-span-2"
        />
      </div>
    );
  }

  if (check.systemKey === "gog_headless_auth") {
    const accounts = asArray<Record<string, unknown>>(check.detail.accounts);
    return (
      <div className="mt-3 space-y-3">
        <div className="grid gap-3 rounded-lg border border-border/50 bg-muted/10 p-3 md:grid-cols-2">
          <StructuredField label="Accounts" value={String(check.detail.accountCount ?? accounts.length ?? 0)} />
          <StructuredField label="Summary" value={asString(check.detail.summary) ?? "No summary"} />
        </div>
        {accounts.map((account, index) => {
          const services = asArray<string>(account.services).map((service) => String(service));
          const scopes = asArray<string>(account.scopes).map((scope) => String(scope));
          return (
            <div key={`${asString(account.email) ?? "account"}-${index}`} className="rounded-lg border border-border/50 bg-background/70 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{asString(account.email) ?? "Unknown account"}</p>
                {asString(account.client) ? <Badge variant="outline">{String(account.client)}</Badge> : null}
                {asString(account.auth) ? <Badge variant="outline">{String(account.auth)}</Badge> : null}
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <StructuredField label="Created" value={asString(account.createdAt) ?? "Unknown"} />
                <StructuredField label="Services" value={services.length > 0 ? services.join(", ") : "No services"} />
                <StructuredField label="Scopes" value={scopes.length > 0 ? scopes.join(", ") : "No scopes"} className="md:col-span-2" />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (check.systemKey === "financial_external_services") {
    const services = asArray<Record<string, unknown>>(check.detail.services).filter((service) => !isRetiredTradingProvider(service));
    const marketDataOps = (check.detail.marketDataOps ?? {}) as Record<string, unknown>;
    return (
      <div className="mt-3 space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          {services.map((service) => (
            <div key={String(service.key ?? service.label ?? "service")} className="rounded-lg border border-border/50 bg-background/70 p-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{asString(service.label) ?? "Service"}</p>
                <Badge variant={checkBadge(asString(service.status) ?? "outline")} className="uppercase">
                  {asString(service.status) ?? "unknown"}
                </Badge>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{asString(service.summary) ?? "No summary"}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-3 rounded-lg border border-border/50 bg-muted/10 p-3 md:grid-cols-2">
          <StructuredField label="Provider mode" value={asString(marketDataOps.providerMode) ?? "Unknown"} />
          <StructuredField label="Ops status" value={asString(marketDataOps.status) ?? "Unknown"} />
          <StructuredField label="Mode reason" value={asString(marketDataOps.providerModeReason) ?? "Unknown"} className="md:col-span-2" />
          {asString(marketDataOps.degradedReason) ? (
            <StructuredField label="Degraded reason" value={asString(marketDataOps.degradedReason) ?? "Unknown"} className="md:col-span-2" />
          ) : null}
        </div>
      </div>
    );
  }

  return null;
}

function formatReadinessOutcome(outcome: string | null | undefined) {
  if (!outcome) return "N/A";
  if (outcome === "no_go") return "NO-GO";
  return outcome.toUpperCase().replaceAll("_", "-");
}

function formatModeLabel(mode: string) {
  if (mode === "active") return "Active";
  if (mode === "ready") return "Prepared";
  if (mode === "prep") return "Planning";
  return "Inactive";
}

function formatWindowStatus(status: string | null | undefined) {
  if (!status) return "Inactive";
  if (status === "ready") return "Prepared";
  if (status === "prep") return "Planning";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function describeWindowStatus(status: string | null | undefined) {
  if (status === "active") return "Away mode is currently running against this window.";
  if (status === "ready") return "Prepared and ready to enable, but not active yet.";
  if (status === "prep") return "Preflight is still staging this window.";
  if (status === "completed") return "Closed after a previous run or QA pass.";
  if (status === "expired") return "Expired without remaining away-mode activity.";
  if (status === "failed") return "Stopped because a required check did not hold.";
  return "No active or prepared vacation window is staged right now.";
}

function describeMode(snapshot: VacationOpsSnapshot, stagedWindow: VacationOpsSnapshot["activeWindow"] | VacationOpsSnapshot["latestWindow"] | null) {
  if (snapshot.mode === "active") {
    return "Vacation mode is active. Daily summaries and bounded self-heal logging are running against the active window.";
  }
  if (snapshot.mode === "ready" && stagedWindow) {
    return `Vacation mode is not active. A prepared window is staged for ${formatWindowLabel(stagedWindow.label)} and can be enabled when you leave.`;
  }
  if (snapshot.mode === "prep") {
    return "Preflight is currently preparing the next away window. Wait for readiness to complete before enabling.";
  }
  if (snapshot.latestWindow) {
    return `Vacation mode is inactive. The last window on record was ${formatWindowLabel(snapshot.latestWindow.label)}.`;
  }
  return "Vacation mode is inactive. No away window has been staged yet.";
}

function formatFreshnessSourceLabel(source: string | null | undefined) {
  switch (source) {
    case "immediate_probe":
      return "On-demand probe";
    case "http_probe":
      return "Live HTTP probe";
    case "heartbeat_status":
      return "Heartbeat status";
    case "runtime_state":
      return "Runtime state";
    case "artifact_and_http":
      return "Artifact + HTTP";
    case "cron_run":
      return "Cron delivery";
    default:
      return "Freshness not tracked";
  }
}

function formatFreshnessLabel(check: VacationCheck) {
  if (check.freshnessAt) {
    return `Freshness ${formatRelative(check.freshnessAt)}`;
  }
  return formatFreshnessSourceLabel(check.freshnessSource);
}

function normalizeToastDates(text: string, timezone?: string) {
  return text
    .replace(
      /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})\b/g,
      (value: string) => formatToastDate(value, timezone),
    )
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, year: string, month: string, day: string) => `${month}/${day}/${year}`)
    .replace(/\b(\d{4})\/(\d{2})\/(\d{2})\b/g, (_, year: string, month: string, day: string) => `${month}/${day}/${year}`);
}

async function requestVacationOps(init?: RequestInit) {
  const response = await fetch("/api/vacation-ops", { cache: "no-store", ...init });
  const payload = (await response.json()) as VacationOpsResponse;
  if (!response.ok || payload.status !== "ok") throw new Error(payload.status === "error" ? payload.message : "Vacation Ops request failed");
  return payload.data;
}

async function requestVacationAction(action: ActionKey, body: Record<string, unknown>) {
  const response = await fetch(`/api/vacation-ops/actions/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as VacationOpsActionResponse;
  if (!response.ok || payload.status !== "ok") throw new Error(payload.status === "error" ? payload.message : `${action} failed`);
  return payload;
}

export function VacationOpsTab() {
  const [data, setData] = React.useState<VacationOpsSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [activeAction, setActiveAction] = React.useState<ActionKey | null>(null);
  const [startParts, setStartParts] = React.useState<PlannerParts>({ ...DEFAULT_PLANNER_PARTS });
  const [endParts, setEndParts] = React.useState<PlannerParts>({ ...DEFAULT_PLANNER_PARTS });
  const [didTouchWindow, setDidTouchWindow] = React.useState(false);
  const [selectedTier, setSelectedTier] = React.useState<string>("tier-0");

  const hydrateWindowInputs = React.useCallback((snapshot: VacationOpsSnapshot) => {
    if (didTouchWindow) return;
    setStartParts(toPlannerParts(snapshot.recommendation.startAt));
    setEndParts(toPlannerParts(snapshot.recommendation.endAt));
  }, [didTouchWindow]);

  const load = React.useCallback(async () => {
    try {
      const next = await requestVacationOps();
      setData(next);
      setError(null);
      hydrateWindowInputs(next);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load Vacation Ops");
    } finally {
      setLoading(false);
    }
  }, [hydrateWindowInputs]);

  React.useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(interval);
  }, [load]);

  React.useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  React.useEffect(() => {
    if (!data || data.latestReadiness?.state !== "running") return;
    const interval = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(interval);
  }, [data, load]);

  const runAction = async (action: ActionKey) => {
    try {
      setActiveAction(action);
      setError(null);
      const payload = await requestVacationAction(action, {
        startAt: action === "prep" ? fromPlannerParts(startParts) : undefined,
        endAt: action === "prep" ? fromPlannerParts(endParts) : undefined,
        timezone: data?.config.timezone,
        windowId: action === "enable"
          ? data?.enableReadyWindowId
          : action === "cancel" && data && data.mode !== "active" && visibleWindow && ["prep", "ready", "failed"].includes(visibleWindow.status)
            ? visibleWindow.id
            : undefined,
        reason: action === "disable" ? "manual" : undefined,
      });
      setData(payload.data);
      if (action !== "prep") {
        setDidTouchWindow(false);
        hydrateWindowInputs(payload.data);
      }
      const summaryText = typeof payload.result.summaryText === "string" ? payload.result.summaryText : null;
      setNotice(summaryText ?? `${action} completed.`);
      window.setTimeout(() => {
        void load();
      }, 1500);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `${action} failed`);
    } finally {
      setActiveAction(null);
    }
  };

  const groupedChecks = React.useMemo(() => {
    const groups = new Map<number, VacationCheck[]>();
    for (const check of data?.latestChecks ?? []) {
      const list = groups.get(check.tier) ?? [];
      list.push(check);
      groups.set(check.tier, list);
    }
    return Array.from(groups.entries()).sort((left, right) => left[0] - right[0]);
  }, [data]);

  const tierTabs = React.useMemo(() => groupedChecks.map(([tier, checks]) => ({ value: `tier-${tier}`, tier, checks })), [groupedChecks]);

  React.useEffect(() => {
    if (tierTabs.length === 0) return;
    if (!tierTabs.some((tierTab) => tierTab.value === selectedTier)) {
      setSelectedTier(tierTabs[0].value);
    }
  }, [selectedTier, tierTabs]);

  const stagedWindow = React.useMemo(() => {
    if (!data) return null;
    if (data.activeWindow) return data.activeWindow;
    if (data.latestWindow && ["ready", "prep"].includes(data.latestWindow.status)) return data.latestWindow;
    return null;
  }, [data]);

  const visibleWindow = stagedWindow ?? data?.latestWindow ?? null;
  const readinessAt = data?.latestReadiness?.completedAt ?? data?.latestReadiness?.startedAt;
  const summaryCadence = data ? formatCadence(data.config.summaryTimes) : "8:00 AM · 8:00 PM";
  const latestWindowDate = visibleWindow ? formatWindowLabel(visibleWindow.label) : null;
  const activePreflight = data?.latestReadiness?.state === "running";
  const toastNotice = notice ? normalizeToastDates(notice, data?.config.timezone) : null;
  const preflightToast = activePreflight
    ? "Preflight is still running. Vacation state and enable controls will refresh automatically when the readiness run completes."
    : null;
  const canUnpauseJobs = Boolean(data && data.mode === "active" && data.pausedJobs.length > 0 && !activePreflight);
  const cancelableWindowId = data && data.mode !== "active" && visibleWindow && ["prep", "ready", "failed"].includes(visibleWindow.status)
    ? visibleWindow.id
    : null;

  return (
    <TabLayout
      title="Vacation Ops"
      subtitle={data ? `Timezone: ${data.config.timezone} · ${data.config.systemCount} tracked systems · Updated ${formatRelative(data.generatedAt)}` : "Away-mode operator surface for preflight, activation, and unattended ops."}
      badge={data ? <Badge variant={modeBadge(data.mode)}>{formatModeLabel(data.mode)}</Badge> : undefined}
      loading={loading && !data}
      error={error}
      actions={<RefreshButton onClick={() => void load()} loading={loading} />}
      stats={
        data ? (
          <>
            <StatCard
              icon={<Palmtree className="h-4 w-4" />}
              label="Mode"
              value={formatModeLabel(data.mode).toUpperCase()}
              sub={stagedWindow ? `${data.mode === "active" ? "Window" : "Prepared"} ${formatWindowLabel(stagedWindow.label)}` : "No scheduled away window"}
            />
            <StatCard
              icon={<ShieldCheck className="h-4 w-4" />}
              label="Readiness"
              value={formatReadinessOutcome(data.latestReadiness?.readinessOutcome)}
              valueClassName={readinessTextClass(data.latestReadiness?.readinessOutcome)}
              sub={readinessAt ? `Completed ${formatRelative(readinessAt)}` : "No readiness run recorded"}
            />
            <StatCard
              icon={<Siren className="h-4 w-4" />}
              label="Incidents"
              value={String(data.counts.activeIncidents)}
              sub={data.counts.humanRequiredIncidents > 0 ? `${data.counts.humanRequiredIncidents} need operator review` : "No operator review needed"}
            />
            <StatCard
              icon={<Timer className="h-4 w-4" />}
              label="Paused Jobs"
              value={String(data.counts.pausedJobs)}
              sub={data.counts.pausedJobs > 0 ? "Paused during away mode" : "No jobs paused"}
            />
          </>
        ) : undefined
      }
    >
      {toastNotice || preflightToast ? (
        <div className="mb-4 flex flex-col gap-3">
          {toastNotice ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/80 dark:text-emerald-200">
              {toastNotice}
            </div>
          ) : null}
          {preflightToast ? (
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/80 dark:text-sky-200">
              {preflightToast}
            </div>
          ) : null}
        </div>
      ) : null}

      {data && (
        <div className="grid gap-4 2xl:grid-cols-[1.15fr_0.85fr]">
          <SectionCard
            icon={<CalendarRange className="h-4 w-4" />}
            title="State & Schedule"
            subtitle="Current away-mode status, scheduled window, and summary cadence"
          >
            <div className="rounded-2xl border border-border/50 bg-muted/10 p-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Vacation state</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={modeBadge(data.mode)}>{formatModeLabel(data.mode)}</Badge>
                {latestWindowDate ? (
                  <span className="text-sm text-muted-foreground">{data.mode === "active" ? `Window ${latestWindowDate}` : `Prepared for ${latestWindowDate}`}</span>
                ) : null}
                <span className="text-sm text-muted-foreground">Summary cadence {summaryCadence}</span>
              </div>
              <p className="mt-3 max-w-4xl text-sm leading-7 text-muted-foreground">{describeMode(data, stagedWindow)}</p>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <InfoPair
                label="State"
                value={describeWindowStatus(visibleWindow?.status)}
                badge={visibleWindow ? <Badge variant={modeBadge(visibleWindow.status)}>{formatWindowStatus(visibleWindow.status)}</Badge> : undefined}
              />
              <InfoPair
                label={stagedWindow ? "Scheduled range" : "Last recorded range"}
                value={visibleWindow ? `${formatDateTime(visibleWindow.startAt, visibleWindow.timezone)} → ${formatDateTime(visibleWindow.endAt, visibleWindow.timezone)}` : "Run preflight to stage a window"}
              />
              <InfoPair
                label={data.mode === "active" ? "Next summary" : "Summary cadence"}
                value={data.mode === "active" && data.nextSummaryAt ? formatDateTime(data.nextSummaryAt, data.config.timezone) : summaryCadence}
              />
              <InfoPair
                label="Latest readiness"
                value={data.latestReadiness?.runType ? `${data.latestReadiness.runType.replaceAll("_", " ")} · ${formatRelative(readinessAt)}` : "No readiness run"}
                badge={<Badge variant={readinessBadge(data.latestReadiness?.readinessOutcome)}>{formatReadinessOutcome(data.latestReadiness?.readinessOutcome)}</Badge>}
              />
              <InfoPair
                label="Runtime mirror"
                value={data.mirror ? `Mirror synced · ${String(data.mirror.status ?? "unknown")}` : "No active runtime mirror"}
              />
              <InfoPair
                label="Paused jobs"
                value={data.pausedJobs.length ? data.pausedJobs.map((job) => job.name).join(", ") : "No jobs paused"}
              />
            </div>

            {data.latestSummary?.summaryText ? (
              <div className="mt-4 rounded-xl border border-border/50 bg-muted/10 p-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Latest summary</p>
                <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm leading-6">{data.latestSummary.summaryText}</pre>
              </div>
            ) : null}
          </SectionCard>

          <SectionCard
            icon={<PlayCircle className="h-4 w-4" />}
            title="Controls"
            subtitle="Stage preflight first, then enable the prepared window"
          >
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <PlannerField label="Start date">
                  <Input
                    type="date"
                    value={startParts.date}
                    onChange={(event) => {
                      setDidTouchWindow(true);
                      setStartParts((current) => ({ ...current, date: event.target.value }));
                    }}
                  />
                </PlannerField>
                <PlannerField label="Start time">
                  <div className="grid grid-cols-3 gap-2">
                    <Select
                      value={startParts.hour}
                      onValueChange={(value) => {
                        setDidTouchWindow(true);
                        setStartParts((current) => ({ ...current, hour: value }));
                      }}
                    >
                      <SelectTrigger className="w-full bg-background/70">
                        <SelectValue placeholder="Hour" />
                      </SelectTrigger>
                      <SelectContent>
                        {HOUR_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={startParts.minute}
                      onValueChange={(value) => {
                        setDidTouchWindow(true);
                        setStartParts((current) => ({ ...current, minute: value }));
                      }}
                    >
                      <SelectTrigger className="w-full bg-background/70">
                        <SelectValue placeholder="Minute" />
                      </SelectTrigger>
                      <SelectContent>
                        {MINUTE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={startParts.meridiem}
                      onValueChange={(value: "AM" | "PM") => {
                        setDidTouchWindow(true);
                        setStartParts((current) => ({ ...current, meridiem: value }));
                      }}
                    >
                      <SelectTrigger className="w-full bg-background/70">
                        <SelectValue placeholder="AM/PM" />
                      </SelectTrigger>
                      <SelectContent>
                        {MERIDIEM_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </PlannerField>
                <PlannerField label="End date">
                  <Input
                    type="date"
                    value={endParts.date}
                    onChange={(event) => {
                      setDidTouchWindow(true);
                      setEndParts((current) => ({ ...current, date: event.target.value }));
                    }}
                  />
                </PlannerField>
                <PlannerField label="End time">
                  <div className="grid grid-cols-3 gap-2">
                    <Select
                      value={endParts.hour}
                      onValueChange={(value) => {
                        setDidTouchWindow(true);
                        setEndParts((current) => ({ ...current, hour: value }));
                      }}
                    >
                      <SelectTrigger className="w-full bg-background/70">
                        <SelectValue placeholder="Hour" />
                      </SelectTrigger>
                      <SelectContent>
                        {HOUR_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={endParts.minute}
                      onValueChange={(value) => {
                        setDidTouchWindow(true);
                        setEndParts((current) => ({ ...current, minute: value }));
                      }}
                    >
                      <SelectTrigger className="w-full bg-background/70">
                        <SelectValue placeholder="Minute" />
                      </SelectTrigger>
                      <SelectContent>
                        {MINUTE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={endParts.meridiem}
                      onValueChange={(value: "AM" | "PM") => {
                        setDidTouchWindow(true);
                        setEndParts((current) => ({ ...current, meridiem: value }));
                      }}
                    >
                      <SelectTrigger className="w-full bg-background/70">
                        <SelectValue placeholder="AM/PM" />
                      </SelectTrigger>
                      <SelectContent>
                        {MERIDIEM_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </PlannerField>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                <ActionButton
                  label="Run preflight"
                  icon={<PlayCircle className="h-4 w-4" />}
                  loading={activeAction === "prep"}
                  onClick={() => void runAction("prep")}
                  disabled={!startParts.date || !startParts.hour || !startParts.minute || !endParts.date || !endParts.hour || !endParts.minute || activeAction != null || activePreflight || data.mode === "active"}
                />
                <ActionButton
                  label="Enable"
                  icon={<Power className="h-4 w-4" />}
                  loading={activeAction === "enable"}
                  onClick={() => void runAction("enable")}
                  disabled={activeAction != null || data.enableReadyWindowId == null || data.mode === "active" || activePreflight}
                />
                <ActionButton
                  label="Disable"
                  icon={<ShieldEllipsis className="h-4 w-4" />}
                  loading={activeAction === "disable"}
                  onClick={() => void runAction("disable")}
                  disabled={activeAction != null || data.mode !== "active" || activePreflight}
                  variant="outline"
                />
                <ActionButton
                  label="Unpause jobs"
                  icon={<Power className="h-4 w-4" />}
                  loading={activeAction === "unpause"}
                  onClick={() => void runAction("unpause")}
                  disabled={activeAction != null || !canUnpauseJobs}
                  variant="outline"
                />
                <ActionButton
                  label="Cancel staged"
                  icon={<AlertTriangle className="h-4 w-4" />}
                  loading={activeAction === "cancel"}
                  onClick={() => void runAction("cancel")}
                  disabled={activeAction != null || cancelableWindowId == null}
                  variant="outline"
                />
              </div>

              <div className="rounded-xl border border-border/50 bg-muted/10 p-4">
                <div className="max-w-[56ch] space-y-2 text-sm leading-6 text-muted-foreground [text-wrap:pretty]">
                  <p>Preflight stages the candidate window and records a fresh readiness run.</p>
                  <p>Vacation mode remains inactive until you explicitly enable the prepared window.</p>
                </div>
              </div>

              {data.pausedJobs.length > 0 ? (
                <div className="rounded-xl border border-border/50 bg-muted/10 p-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Paused jobs</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {data.pausedJobs.map((job) => (
                      <Badge key={job.id} variant="outline">{job.name}</Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </SectionCard>
        </div>
      )}

      {data && (
        <SectionCard
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Latest checks"
          subtitle="Tiered readiness results from the most recent preflight run"
          count={data.latestChecks.length}
        >
          {data.latestChecks.length === 0 ? (
            <EmptyState message="No readiness checks recorded yet. Run preflight to populate this view." />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {data.tierRollup.map((tier) => (
                  <TierRollupCard key={tier.tier} rollup={tier} active={selectedTier === `tier-${tier.tier}`} onSelect={() => setSelectedTier(`tier-${tier.tier}`)} />
                ))}
              </div>

              <Tabs value={selectedTier} onValueChange={setSelectedTier} className="space-y-3">
                <TabsList variant="line" className="w-full justify-start overflow-x-auto font-mono text-xs uppercase tracking-wide">
                  {tierTabs.map((tierTab) => (
                    <TabsTrigger key={tierTab.value} value={tierTab.value}>Tier {tierTab.tier}</TabsTrigger>
                  ))}
                </TabsList>

                {tierTabs.map((tierTab) => (
                  <TabsContent key={tierTab.value} value={tierTab.value} className="space-y-3">
                    {tierTab.checks.map((check) => (
                      <details key={check.id} className="rounded-xl border border-border/50 bg-background/60 px-3 py-3">
                        <summary className="flex list-none cursor-pointer flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="min-w-0 truncate text-sm font-medium">{check.systemLabel}</p>
                              <Badge variant={checkBadge(check.status)} className="uppercase">{check.status}</Badge>
                              {check.remediationAttempted ? (
                                <Badge variant={check.remediationSucceeded ? "success" : "warning"}>
                                  {check.remediationSucceeded ? "self-healed" : "remediation tried"}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 break-words text-xs leading-5 text-muted-foreground line-clamp-2">{summarizeDetail(check.detail)}</p>
                          </div>
                          <div className="grid shrink-0 gap-1 text-[11px] text-muted-foreground sm:text-right">
                            <div>Observed {formatRelative(check.observedAt)}</div>
                            <div>{formatFreshnessLabel(check)}</div>
                          </div>
                        </summary>
                        {renderStructuredCheckDetail(check) ?? (
                          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-muted/10 p-3 text-xs leading-5 text-muted-foreground">{JSON.stringify(check.detail, null, 2)}</pre>
                        )}
                      </details>
                    ))}
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          )}
        </SectionCard>
      )}

      {data && (
        <div className="grid gap-4 xl:grid-cols-2">
          <SectionCard
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Incidents"
            subtitle="Open, degraded, and resolved away-mode incidents"
            count={data.recentIncidents.length}
          >
            {data.recentIncidents.length === 0 ? (
              <EmptyState message="No incidents recorded for the current or latest window." />
            ) : (
              <div className="space-y-2">
                {data.recentIncidents.map((incident) => (
                  <IncidentRow key={incident.id} incident={incident} />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            icon={<Timer className="h-4 w-4" />}
            title="Recent remediations"
            subtitle="Latest bounded actions attempted while away-mode logic was active"
            count={data.recentActions.length}
          >
            {data.recentActions.length === 0 ? (
              <EmptyState message="No remediation actions recorded yet." />
            ) : (
              <div className="space-y-2">
                {data.recentActions.map((action) => (
                  <div key={action.id} className="rounded-xl border border-border/50 bg-background/70 px-3 py-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium">{action.systemLabel}</p>
                          <Badge variant={checkBadge(action.actionStatus)} className="uppercase">{action.actionStatus}</Badge>
                          {action.verificationStatus ? <Badge variant={checkBadge(action.verificationStatus)}>{action.verificationStatus}</Badge> : null}
                        </div>
                        <p className="mt-1 break-words text-xs text-muted-foreground">{action.actionKind.replaceAll("_", " ")}</p>
                      </div>
                      <div className="grid shrink-0 gap-1 text-[11px] text-muted-foreground sm:text-right">
                        <div>Step {action.stepOrder}</div>
                        <div>{formatRelative(action.startedAt)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </TabLayout>
  );
}

function PlannerField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function InfoPair({ label, value, badge }: { label: string; value: string; badge?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        {badge}
      </div>
      <p className="mt-2 break-words text-sm font-medium leading-6">{value}</p>
    </div>
  );
}

function TierRollupCard({
  rollup,
  active,
  onSelect,
}: {
  rollup: VacationTierRollup;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "rounded-xl border p-3 text-left transition-colors",
        active ? "border-sky-500/40 bg-sky-500/10" : "border-border/50 bg-background/60 hover:bg-muted/20",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Tier {rollup.tier}</p>
        <span className="text-xs text-muted-foreground">{rollup.total} systems</span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] text-muted-foreground">Green</p>
          <AnimatedValue value={rollup.green} className="text-xl font-semibold" />
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Warn</p>
          <AnimatedValue value={rollup.yellow} className="text-xl font-semibold text-amber-600 dark:text-amber-300" />
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Red</p>
          <AnimatedValue value={rollup.red} className="text-xl font-semibold text-red-600 dark:text-red-300" />
        </div>
      </div>
    </button>
  );
}

function IncidentRow({ incident }: { incident: VacationIncident }) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/70 px-3 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">{incident.systemLabel}</p>
            <Badge variant={checkBadge(incident.status)} className="uppercase">{incident.status}</Badge>
            {incident.humanRequired ? <Badge variant="destructive">operator</Badge> : null}
          </div>
          <p className="mt-1 break-words text-xs leading-5 text-muted-foreground line-clamp-2">{incident.symptom || summarizeDetail(incident.detail)}</p>
        </div>
        <div className="grid shrink-0 gap-1 text-[11px] text-muted-foreground sm:text-right">
          <div>Tier {incident.tier}</div>
          <div>{formatRelative(incident.lastObservedAt)}</div>
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
  loading,
  variant = "default",
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "default" | "outline";
}) {
  return (
    <Button
      variant={variant}
      className={cn(
        "h-auto w-full justify-start px-3 py-3 text-left",
        variant === "outline" && "bg-background/70",
      )}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="flex w-full items-center gap-2">
        <span className="shrink-0">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}</span>
        <span className="leading-none">{label}</span>
      </span>
    </Button>
  );
}

function StructuredField({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="break-words text-sm leading-6">{value}</p>
    </div>
  );
}
