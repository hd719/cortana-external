"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ThinkingPayload = {
  ok: boolean;
  idle: boolean;
  current: string;
  items: string[];
  updatedAt: string;
};

const POLL_MS = 12_000;
const ROTATE_MS = 4_000;

export function ThinkingIndicator() {
  const [payload, setPayload] = useState<ThinkingPayload | null>(null);
  const [error, setError] = useState(false);
  const [index, setIndex] = useState(0);

  const fetchThinkingStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/thinking-status", { cache: "no-store" });
      if (!res.ok) throw new Error("thinking-status failed");

      const next = (await res.json()) as ThinkingPayload;
      setPayload(next);
      setError(false);
      setIndex((prev) => (next.items.length === 0 ? 0 : prev % next.items.length));
    } catch {
      setError(true);
      setPayload((prev) =>
        prev ?? {
          ok: false,
          idle: true,
          current: "Systems nominal.",
          items: ["Systems nominal."],
          updatedAt: new Date().toISOString(),
        }
      );
    }
  }, []);

  useEffect(() => {
    fetchThinkingStatus();
    const interval = window.setInterval(fetchThinkingStatus, POLL_MS);
    return () => window.clearInterval(interval);
  }, [fetchThinkingStatus]);

  useEffect(() => {
    const itemCount = payload?.items.length ?? 0;
    if (itemCount <= 1) return;

    const interval = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % itemCount);
    }, ROTATE_MS);

    return () => window.clearInterval(interval);
  }, [payload?.items.length]);

  const currentText = useMemo(() => {
    const items = payload?.items ?? ["Systems nominal."];
    return items[Math.min(index, items.length - 1)] || "Systems nominal.";
  }, [payload?.items, index]);

  const isIdle = payload?.idle ?? true;

  return (
    <div className="flex h-full flex-col justify-center rounded-lg border bg-card/60 px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`thinking-dot ${isIdle ? "thinking-idle" : "thinking-active"}`} aria-hidden="true" />
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Cortana processing
        </p>
      </div>

      <p className="mt-1 text-sm font-medium text-foreground">
        {currentText}
      </p>

      <p className="mt-1 text-xs text-muted-foreground">
        {error ? "Telemetry reconnecting..." : `Updated ${new Date(payload?.updatedAt ?? Date.now()).toLocaleTimeString()}`}
      </p>
    </div>
  );
}
