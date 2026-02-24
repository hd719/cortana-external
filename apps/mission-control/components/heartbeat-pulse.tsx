"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type HeartbeatStatus = "healthy" | "stale" | "missed" | "unknown";

type HeartbeatPayload = {
  ok: boolean;
  lastHeartbeat: number | null;
  status: HeartbeatStatus;
  ageMs: number | null;
};

const POLL_MS = 30_000;

function formatLastHeartbeat(ageMs: number | null, status: HeartbeatStatus) {
  if (ageMs == null) return "Last heartbeat: never";

  const totalMinutes = Math.max(0, Math.floor(ageMs / 60_000));
  if (totalMinutes < 1) return "Last heartbeat: just now";

  if (totalMinutes < 60) {
    return `Last heartbeat: ${totalMinutes} min ago${status !== "healthy" ? " ⚠️" : ""}`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (mins === 0) {
    return `Last heartbeat: ${hours}h ago${status !== "healthy" ? " ⚠️" : ""}`;
  }

  return `Last heartbeat: ${hours}h ${mins}m ago${status !== "healthy" ? " ⚠️" : ""}`;
}

export function HeartbeatPulse() {
  const [data, setData] = useState<HeartbeatPayload | null>(null);
  const [error, setError] = useState(false);

  const fetchHeartbeat = useCallback(async () => {
    try {
      const res = await fetch("/api/heartbeat-status", {
        cache: "no-store",
      });

      if (!res.ok) throw new Error("heartbeat-status failed");

      const payload = (await res.json()) as HeartbeatPayload;
      setData(payload);
      setError(false);
    } catch {
      setError(true);
      setData((prev) =>
        prev ?? {
          ok: false,
          lastHeartbeat: null,
          status: "unknown",
          ageMs: null,
        }
      );
    }
  }, []);

  useEffect(() => {
    fetchHeartbeat();
    const interval = window.setInterval(fetchHeartbeat, POLL_MS);
    return () => window.clearInterval(interval);
  }, [fetchHeartbeat]);

  const status = data?.status ?? "unknown";

  const statusLabel = useMemo(() => {
    switch (status) {
      case "healthy":
        return "Live";
      case "stale":
        return "Stale";
      case "missed":
        return "Missed";
      default:
        return "Unknown";
    }
  }, [status]);

  return (
    <div className="rounded-lg border bg-card/60 px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2">
        <span
          className={`heartbeat-dot heartbeat-${status}`}
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-foreground">Cortana heartbeat: {statusLabel}</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {formatLastHeartbeat(data?.ageMs ?? null, status)}
        {error ? " (reconnecting...)" : ""}
      </p>
    </div>
  );
}
