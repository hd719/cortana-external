"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Radio, RefreshCcw, Send, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatTimestamp } from "@/lib/format-utils";
import type { WhoopLiveEvent } from "@/lib/whoop-live-events";

type Props = {
  events: WhoopLiveEvent[];
  warning?: string;
};

const statusMeta = (status: string) => {
  if (status === "sent") return { variant: "success" as const, icon: Send, dot: "bg-emerald-500" };
  if (status === "processed" || status === "no_reply") return { variant: "secondary" as const, icon: CheckCircle2, dot: "bg-sky-500" };
  if (status === "queued" || status === "coalesced") return { variant: "info" as const, icon: CircleDashed, dot: "bg-sky-400" };
  if (status === "failed") return { variant: "destructive" as const, icon: XCircle, dot: "bg-red-500" };
  return { variant: "outline" as const, icon: Radio, dot: "bg-muted-foreground" };
};

const sourceLabel = (source: string) => {
  if (source === "webhook") return "Webhook";
  if (source === "cron") return "Cron";
  if (source === "manual") return "Manual";
  return source;
};

function canReprocess(event: WhoopLiveEvent): boolean {
  return event.source === "webhook" && Boolean(event.traceId) && ["failed", "processed", "coalesced", "ignored"].includes(event.status);
}

export function WhoopLiveEventsPanel({ events, warning }: Props) {
  const [pendingTraceId, setPendingTraceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const reprocess = (event: WhoopLiveEvent) => {
    const traceId = event.traceId;
    if (!traceId) return;
    if (!window.confirm(`Reprocess WHOOP event ${traceId}?`)) return;

    setPendingTraceId(traceId);
    setError(null);
    startTransition(() => {
      void fetch(`/api/mjolnir/whoop-events/${encodeURIComponent(traceId)}/reprocess`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true, reason: "operator requested replay from Mjolnir" }),
      })
        .then(async (response) => {
          if (!response.ok) {
            const payload = await response.json().catch(() => ({})) as { error?: string };
            throw new Error(payload.error ?? `Reprocess failed (${response.status})`);
          }
          if (process.env.NODE_ENV !== "test") {
            window.location.reload();
          }
        })
        .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
        .finally(() => setPendingTraceId(null));
    });
  };

  return (
    <Card className="gap-0 overflow-hidden py-0 transition-colors hover:border-emerald-300/50 dark:hover:border-emerald-700/40">
      <CardHeader className="border-b border-border/30 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <CardTitle className="text-sm font-semibold uppercase tracking-wide">WHOOP Live Events</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={warning ? "warning" : "success"} className="text-[10px]">
              {warning ? "setup" : "tracking"}
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">
              {events.length}
            </Badge>
          </div>
        </div>
        {warning ? <p className="text-[10px] text-muted-foreground">{warning}</p> : null}
        {error ? (
          <div className="mt-2 flex items-center gap-2 text-[10px] text-destructive">
            <AlertTriangle className="h-3 w-3" />
            <span>{error}</span>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="px-0 py-0">
        {events.length === 0 ? (
          <div className="px-5 py-5 text-xs text-muted-foreground">
            No WHOOP webhook, cron, or manual activity has been recorded yet.
          </div>
        ) : (
          <div className="divide-y divide-border/20">
            {events.slice(0, 8).map((event) => {
              const meta = statusMeta(event.status);
              const Icon = meta.icon;
              const isEventPending = isPending && pendingTraceId === event.traceId;
              const policyReason = typeof event.metadata.policy_reason === "string" ? event.metadata.policy_reason : null;

              return (
                <div key={event.id} className="grid gap-3 px-5 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
                      <span className="text-xs font-semibold">{event.summary ?? `${event.activityType} ${event.status}`}</span>
                      <Badge variant="outline" className="text-[10px]">{sourceLabel(event.source)}</Badge>
                      <Badge variant={meta.variant} className="text-[10px]">
                        <Icon className="h-3 w-3" />
                        {event.status}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                      <span>{formatTimestamp(event.createdAt)}</span>
                      <span className="font-mono">{event.activityType}</span>
                      {event.traceId ? <span className="font-mono">trace {event.traceId.slice(0, 8)}</span> : null}
                      {policyReason ? <span className="truncate">{policyReason}</span> : null}
                    </div>
                  </div>
                  {canReprocess(event) ? (
                    <button
                      type="button"
                      className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                      disabled={isEventPending}
                      onClick={() => reprocess(event)}
                    >
                      <RefreshCcw className={cn("h-3.5 w-3.5", isEventPending && "animate-spin")} />
                      Reprocess
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
