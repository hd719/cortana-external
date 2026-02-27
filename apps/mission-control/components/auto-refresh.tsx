"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type AutoRefreshProps = {
  intervalMs?: number;
  sourceUrl?: string;
};

export function AutoRefresh({ intervalMs = 2500, sourceUrl = "/api/live" }: AutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    let stopped = false;
    let source: EventSource | null = null;
    let fallbackInterval: number | null = null;

    const refresh = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };

    const startFallback = () => {
      if (fallbackInterval !== null) return;
      fallbackInterval = window.setInterval(refresh, intervalMs);
    };

    const stopFallback = () => {
      if (fallbackInterval !== null) {
        window.clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };

    const connect = () => {
      if (stopped) return;
      try {
        source = new EventSource(sourceUrl);
        source.addEventListener("ready", refresh);
        source.addEventListener("tick", refresh);
        source.onerror = () => {
          source?.close();
          source = null;
          startFallback();
          window.setTimeout(connect, 1500);
        };
      } catch {
        startFallback();
      }
    };

    connect();

    const onFocus = () => refresh();
    const onVisible = () => refresh();

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      source?.close();
      stopFallback();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, router, sourceUrl]);

  return null;
}
