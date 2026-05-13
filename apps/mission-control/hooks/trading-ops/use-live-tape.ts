"use client";

import { useCallback, useEffect, useState } from "react";
import type { TradingOpsLiveData } from "@/lib/trading-ops-contract";

const LIVE_POLL_MS = 15_000;
const LIVE_STREAM_RETRY_MS = 2_000;

export type UseLiveTapeResult = {
  data: TradingOpsLiveData | null;
  error: string | null;
  lastSuccessfulAt: string | null;
};

export function useLiveTape(): UseLiveTapeResult {
  const [data, setData] = useState<TradingOpsLiveData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<string | null>(null);

  const apply = useCallback((payload: TradingOpsLiveData) => {
    setData(payload);
    setError(null);
    setLastSuccessfulAt(payload.generatedAt);
  }, []);

  const fetchOnce = useCallback(async () => {
    try {
      const response = await fetch("/api/trading-ops/live", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Live route failed (${response.status})`);
      }
      const payload = (await response.json()) as TradingOpsLiveData;
      apply(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Live route failed");
    }
  }, [apply]);

  useEffect(() => {
    let stopped = false;
    let source: EventSource | null = null;
    let fallbackInterval: number | null = null;
    let reconnectTimeout: number | null = null;

    const disconnect = () => {
      source?.close();
      source = null;
    };

    const stopFallback = () => {
      if (fallbackInterval !== null) {
        window.clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };

    const startFallback = () => {
      if (fallbackInterval !== null || document.hidden) return;
      fallbackInterval = window.setInterval(() => {
        void fetchOnce();
      }, LIVE_POLL_MS);
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimeout !== null || document.hidden) return;
      reconnectTimeout = window.setTimeout(() => {
        reconnectTimeout = null;
        connect();
      }, LIVE_STREAM_RETRY_MS);
    };

    const connect = () => {
      if (stopped || source || document.hidden || typeof EventSource === "undefined") return;

      try {
        source = new EventSource("/api/trading-ops/live/stream");
        source.addEventListener("snapshot", (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data) as TradingOpsLiveData;
            apply(payload);
            stopFallback();
          } catch {
            setError("Live stream payload could not be parsed.");
          }
        });
        source.addEventListener("warning", (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data) as { message?: string };
            setError(payload.message ?? "Live stream warning");
          } catch {
            setError("Live stream warning");
          }
        });
        source.onerror = () => {
          disconnect();
          setError((current) => current ?? "Live stream reconnecting. Falling back to snapshots.");
          void fetchOnce();
          startFallback();
          scheduleReconnect();
        };
      } catch {
        startFallback();
      }
    };

    void fetchOnce();
    connect();

    const handleVisibility = () => {
      if (!document.hidden) {
        stopFallback();
        void fetchOnce();
        connect();
        return;
      }

      disconnect();
      stopFallback();
      if (reconnectTimeout !== null) {
        window.clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stopped = true;
      disconnect();
      stopFallback();
      if (reconnectTimeout !== null) {
        window.clearTimeout(reconnectTimeout);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [apply, fetchOnce]);

  return { data, error, lastSuccessfulAt };
}
