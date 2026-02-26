"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ActivitySeverity = "success" | "error" | "info" | "warning";

type ActivityEvent = {
  id: number;
  timestamp: string;
  eventType: string;
  source: string;
  severity: ActivitySeverity;
  message: string;
};

type ActivityFeedResponse = {
  source: "cortana" | "app";
  events: ActivityEvent[];
};

const POLL_MS = 20_000;
const BOTTOM_THRESHOLD = 20;

const severityClass: Record<ActivitySeverity, string> = {
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  error: "border-red-500/30 bg-red-500/10 text-red-300",
  info: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-300",
};

const severityIcon: Record<ActivitySeverity, string> = {
  success: "●",
  error: "✖",
  info: "○",
  warning: "⚠",
};

const timeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "2-digit",
  day: "2-digit",
});

const formatTimestamp = (iso: string) => {
  const date = new Date(iso);
  return `${dateFmt.format(date)} ${timeFmt.format(date)}`;
};

export function ActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [source, setSource] = useState<"cortana" | "app" | null>(null);
  const [error, setError] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const shouldStickRef = useRef(true);

  const fetchFeed = useCallback(async () => {
    try {
      const res = await fetch("/api/activity-feed", { cache: "no-store" });
      if (!res.ok) throw new Error("activity-feed failed");
      const payload = (await res.json()) as ActivityFeedResponse;
      setSource(payload.source);
      setEvents(payload.events);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    fetchFeed();
    const interval = window.setInterval(fetchFeed, POLL_MS);
    return () => window.clearInterval(interval);
  }, [fetchFeed]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (shouldStickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [events]);

  const orderedEvents = useMemo(() => [...events].reverse(), [events]);

  return (
    <div className="rounded-lg border bg-card/50 p-3">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Activity Feed · last {events.length}
        </p>
        <p className="font-mono text-[11px] text-muted-foreground">
          refresh {POLL_MS / 1000}s {source ? `· ${source} db` : ""}
        </p>
      </div>

      <div
        ref={scrollerRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
          shouldStickRef.current = distanceToBottom < BOTTOM_THRESHOLD;
        }}
        className="h-[360px] overflow-y-auto rounded-md border bg-zinc-950/70 p-2 font-mono text-xs"
      >
        {orderedEvents.length === 0 ? (
          <p className="px-1 py-2 text-muted-foreground">No activity yet.</p>
        ) : (
          <div className="space-y-1">
            {orderedEvents.map((event) => (
              <div
                key={event.id}
                className="rounded border border-white/5 bg-black/20 px-2 py-1.5"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="shrink-0 text-[10px] text-zinc-400">
                    {formatTimestamp(event.timestamp)}
                  </span>
                  <span
                    className={`inline-flex shrink-0 items-center justify-center rounded border px-1.5 py-0.5 text-[10px] uppercase ${severityClass[event.severity]}`}
                  >
                    {severityIcon[event.severity]} {event.severity}
                  </span>
                  <p className="truncate text-[10px] uppercase tracking-wide text-zinc-400">
                    {event.eventType.replaceAll("_", " ")}
                  </p>
                </div>
                <p className="mt-0.5 break-words text-zinc-100/90">{event.message || event.eventType}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {error ? (
        <p className="mt-2 font-mono text-[11px] text-amber-400">Feed temporarily unavailable. Retrying…</p>
      ) : null}
    </div>
  );
}
