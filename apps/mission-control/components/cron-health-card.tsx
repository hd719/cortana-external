"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type CronHealthStatus = "healthy" | "late" | "failed";
type CronDisplayStatus = "healthy" | "overdue" | "failed";
type CronActionRecommendation = "watch" | "run-now" | "investigate";

type CronHealthChannelStatus =
  | "delivery_required_failed"
  | "healthy_silent"
  | "gateway_drain_retry_pending"
  | "normal";

type CronHealthItem = {
  name: string;
  schedule: string;
  last_fire_time: string | null;
  next_fire_time: string | null;
  status: CronHealthStatus;
  display_status?: CronDisplayStatus;
  action_recommendation?: CronActionRecommendation | null;
  channel_status?: CronHealthChannelStatus;
  consecutive_failures: number;
  last_duration_sec: number | null;
  last_error: string | null;
  delivery_mode: string;
  no_reply_expected: boolean;
};

type CronHealthResponse = {
  generatedAt: string;
  crons: CronHealthItem[];
};

const statusUi: Record<CronHealthStatus, { icon: string; label: string; className: string }> = {
  failed: {
    icon: "❌",
    label: "Failed",
    className: "bg-red-500/15 text-black border-red-500/30",
  },
  late: {
    icon: "⚠️",
    label: "Overdue",
    className: "bg-amber-500/15 text-black border-amber-500/30",
  },
  healthy: {
    icon: "✅",
    label: "Healthy",
    className: "bg-emerald-500/15 text-black border-emerald-500/30",
  },
};

const deliveryUi: Record<string, { label: string; className: string }> = {
  announce: {
    label: "Announce",
    className: "bg-sky-500/20 text-black border-sky-400/40",
  },
  "manual-send": {
    label: "Manual send",
    className: "bg-indigo-500/20 text-black border-indigo-400/40",
  },
  none: {
    label: "No delivery",
    className: "bg-zinc-500/20 text-black border-zinc-400/40",
  },
};

const noReplyUi = {
  label: "NO_REPLY expected",
  className: "bg-zinc-500/20 text-black border-zinc-400/40",
  title: "Healthy runs may be silent by contract.",
};

const channelStatusUi: Record<CronHealthChannelStatus, { label: string; className: string; title: string }> = {
  delivery_required_failed: {
    label: "Delivery required + failed",
    className: "bg-red-500/15 text-black border-red-500/30",
    title: "Job was expected to deliver a message but delivery failed.",
  },
  healthy_silent: {
    label: "Healthy silent",
    className: "bg-zinc-500/20 text-black border-zinc-400/40",
    title: "Silent run is expected by contract.",
  },
  gateway_drain_retry_pending: {
    label: "Gateway drain (retry pending)",
    className: "bg-amber-500/15 text-black border-amber-500/30",
    title: "Failure appears transient during gateway restart/drain.",
  },
  normal: {
    label: "Normal",
    className: "bg-emerald-500/20 text-black border-emerald-400/40",
    title: "No channel delivery anomaly detected.",
  },
};

const actionUi: Record<CronActionRecommendation, { label: string; className: string; title: string }> = {
  watch: {
    label: "Action: Watch",
    className: "bg-amber-500/15 text-black border-amber-500/30",
    title: "Single-interval overdue with no errors. Monitor the next run.",
  },
  "run-now": {
    label: "Action: Run now",
    className: "bg-sky-500/15 text-black border-sky-500/30",
    title: "User-facing overdue job. Trigger an immediate run.",
  },
  investigate: {
    label: "Action: Investigate",
    className: "bg-red-500/15 text-black border-red-500/30",
    title: "Repeated overdue state or errors detected. Investigate before auto-retrying.",
  },
};

export const getDisplayStatus = (cron: Pick<CronHealthItem, "status" | "display_status">): CronDisplayStatus =>
  cron.display_status ?? (cron.status === "late" ? "overdue" : cron.status);

export const getActionUi = (recommendation?: CronActionRecommendation | null) =>
  recommendation ? actionUi[recommendation] : null;

const getDeliveryUi = (mode: string) => {
  const normalized = (mode || "none").trim().toLowerCase();
  if (deliveryUi[normalized]) return deliveryUi[normalized];
  const label = mode?.trim() ? `Delivery: ${mode.trim()}` : "No delivery";
  return {
    label,
    className: "bg-zinc-500/20 text-black border-zinc-400/40",
  };
};

const toRelativeTime = (iso: string | null) => {
  if (!iso) return "never";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";

  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const toShortTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
};

const firedToday = (iso: string | null) => {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
};

const formatDuration = (seconds: number | null) => {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
};

export function CronHealthCard() {
  const [data, setData] = useState<CronHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHealthy, setShowHealthy] = useState(false);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const response = await fetch("/api/cron-health", { cache: "no-store" });
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        const payload = (await response.json()) as CronHealthResponse;
        if (!alive) return;
        setData(payload);
        setError(null);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Failed to load cron health.");
      }
    };

    load();
    const interval = setInterval(load, 30_000);

    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  const crons = useMemo(() => [...(data?.crons || [])], [data]);

  const counts = useMemo(() => {
    const summary = { healthy: 0, late: 0, failed: 0 };
    for (const cron of crons) summary[cron.status] += 1;
    return summary;
  }, [crons]);

  const failedOrLateCrons = useMemo(
    () =>
      crons
        .filter((cron: CronHealthItem) => cron.status !== "healthy")
        .sort(
          (a, b) =>
            new Date(b.last_fire_time ?? 0).getTime() - new Date(a.last_fire_time ?? 0).getTime(),
        ),
    [crons],
  );

  const healthyCrons = useMemo(
    () =>
      crons
        .filter((cron: CronHealthItem) => cron.status === "healthy")
        .sort(
          (a, b) =>
            new Date(b.last_fire_time ?? 0).getTime() - new Date(a.last_fire_time ?? 0).getTime(),
        ),
    [crons],
  );

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Cron health</CardTitle>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge className={statusUi.failed.className}>❌ {counts.failed}</Badge>
            <Badge className={statusUi.late.className}>⚠️ {counts.late}</Badge>
            <Badge className={statusUi.healthy.className}>✅ {counts.healthy}</Badge>
          </div>
        </div>
        {data?.generatedAt && (
          <p className="text-xs text-muted-foreground">Updated {toRelativeTime(data.generatedAt)}</p>
        )}
      </CardHeader>
      <CardContent>
        {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

        <div className="space-y-3">
          {failedOrLateCrons.map((cron: CronHealthItem) => {
            const status = statusUi[cron.status];
            const displayStatus = getDisplayStatus(cron);
            const action = getActionUi(cron.action_recommendation);
            const delivery = getDeliveryUi(cron.delivery_mode);
            const channel = channelStatusUi[cron.channel_status ?? "normal"];

            return (
              <div
                key={cron.name}
                className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 sm:p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{cron.name}</p>
                    <p className="font-mono text-[11px] text-zinc-400">{cron.schedule}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge className={delivery.className}>{delivery.label}</Badge>
                      {cron.no_reply_expected && (
                        <Badge className={noReplyUi.className} title={noReplyUi.title}>
                          {noReplyUi.label}
                        </Badge>
                      )}
                      <Badge className={channel.className} title={channel.title}>
                        {channel.label}
                      </Badge>
                      {action && (
                        <Badge className={action.className} title={action.title}>
                          {action.label}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Badge className={status.className}>
                    {status.icon} {status.label}
                  </Badge>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:grid-cols-5">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide">Last fired</p>
                    <p className="font-mono text-foreground">{toRelativeTime(cron.last_fire_time)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide">Next fire</p>
                    <p className="font-mono text-foreground">{cron.next_fire_time ? toShortTime(cron.next_fire_time) : "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide">Consecutive fails</p>
                    <p className="font-mono text-foreground">{cron.consecutive_failures}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide">Duration</p>
                    <p className="font-mono text-foreground">{formatDuration(cron.last_duration_sec)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide">Status</p>
                    <p className="font-mono text-foreground">{displayStatus}</p>
                  </div>
                </div>

                {cron.last_error && (
                  <p className="mt-3 break-words rounded border border-red-900/40 bg-red-950/30 px-2 py-1 font-mono text-[11px] text-red-300">
                    {cron.last_error}
                  </p>
                )}
              </div>
            );
          })}

          {healthyCrons.length > 0 && (
            <div className="rounded-lg border bg-muted/40">
              <button
                type="button"
                onClick={() => setShowHealthy((prev) => !prev)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-muted-foreground transition hover:bg-muted/70"
              >
                <span>{showHealthy ? `Hide ${healthyCrons.length} healthy crons` : `✅ ${healthyCrons.length} healthy — show`}</span>
                <span aria-hidden="true">{showHealthy ? "▲" : "▼"}</span>
              </button>

              {showHealthy && (
                <div className="border-t">
                  {healthyCrons.map((cron: CronHealthItem) => {
                    const delivery = getDeliveryUi(cron.delivery_mode);
                    const channel = channelStatusUi[cron.channel_status ?? "normal"];

                    return (
                      <div
                        key={cron.name}
                        className="grid grid-cols-1 gap-1 px-3 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center sm:gap-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{cron.name}</p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <Badge className={delivery.className}>{delivery.label}</Badge>
                            {cron.no_reply_expected && (
                              <Badge className={noReplyUi.className} title={noReplyUi.title}>
                                {noReplyUi.label}
                              </Badge>
                            )}
                            <Badge className={channel.className} title={channel.title}>
                              {channel.label}
                            </Badge>
                          </div>
                        </div>
                      <p className="font-mono text-muted-foreground">
                        {firedToday(cron.last_fire_time)
                          ? <><span className="text-muted-foreground/60">fired </span>{toShortTime(cron.last_fire_time)} <span className="text-muted-foreground/60">({toRelativeTime(cron.last_fire_time)})</span></>
                          : <><span className="text-muted-foreground/60">last </span>{toRelativeTime(cron.last_fire_time)}</>
                        }
                      </p>
                      <p className="font-mono text-muted-foreground">
                        <span className="text-muted-foreground/60">next </span>{cron.next_fire_time ? toShortTime(cron.next_fire_time) : "—"}
                      </p>
                        {cron.last_duration_sec != null && (
                          <p className="font-mono text-muted-foreground"><span className="text-muted-foreground/60">took </span>{formatDuration(cron.last_duration_sec)}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {crons.length === 0 && (
            <div className="rounded-md border px-3 py-8 text-center text-sm text-muted-foreground">
              No cron definitions found.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
