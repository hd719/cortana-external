"use client";

import { useCallback, useEffect, useState } from "react";
import type { TradingOpsPolymarketLiveData } from "@/lib/trading-ops-contract";
import {
  isPolymarketLivePayload,
  isPolymarketLiveReady,
} from "@/lib/trading-ops/polymarket-helpers";

const POLYMARKET_LIVE_POLL_MS = 15_000;
const POLYMARKET_LIVE_STREAM_RETRY_MS = 2_000;
const POLYMARKET_STARTUP_GRACE_MS = 12_000;

type MarketRow = TradingOpsPolymarketLiveData["markets"][number];

export type UsePolymarketLiveResult = {
  data: TradingOpsPolymarketLiveData | null;
  error: string | null;
  lastSuccessfulAt: string | null;
  warmupComplete: boolean;
  pinPendingSlugs: string[];
  mutatePin: (market: MarketRow, action: "pin" | "remove") => Promise<void>;
};

export function usePolymarketLive(): UsePolymarketLiveResult {
  const [data, setData] = useState<TradingOpsPolymarketLiveData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<string | null>(null);
  const [warmupComplete, setWarmupComplete] = useState(false);
  const [pinPendingSlugs, setPinPendingSlugs] = useState<string[]>([]);

  const apply = useCallback((payload: TradingOpsPolymarketLiveData) => {
    setData(payload);
    setError(null);
    setLastSuccessfulAt(payload.generatedAt);
    if (isPolymarketLiveReady(payload)) {
      setWarmupComplete(true);
    }
  }, []);

  const fetchOnce = useCallback(async () => {
    try {
      const response = await fetch("/api/trading-ops/polymarket/live", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Polymarket live route failed (${response.status})`);
      }
      const payload = (await response.json()) as unknown;
      if (!isPolymarketLivePayload(payload)) {
        throw new Error("Polymarket live route returned an invalid payload");
      }
      apply(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Polymarket live route failed");
    }
  }, [apply]);

  const mutatePin = useCallback(async (market: MarketRow, action: "pin" | "remove") => {
    try {
      setPinPendingSlugs((current) => (
        current.includes(market.slug) ? current : [...current, market.slug]
      ));
      const response = await fetch(
        action === "pin"
          ? "/api/trading-ops/polymarket/pins"
          : `/api/trading-ops/polymarket/pins/${encodeURIComponent(market.slug)}`,
        {
          method: action === "pin" ? "POST" : "DELETE",
          headers: action === "pin" ? { "content-type": "application/json" } : undefined,
          body:
            action === "pin"
              ? JSON.stringify({
                  marketSlug: market.slug,
                  bucket: market.bucket,
                  title: market.title || "Untitled market",
                  eventTitle: market.eventTitle,
                  league: market.league,
                })
              : undefined,
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `Polymarket ${action} failed (${response.status})`);
      }

      await fetchOnce();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Polymarket ${action} failed`);
    } finally {
      setPinPendingSlugs((current) => current.filter((slug) => slug !== market.slug));
    }
  }, [fetchOnce]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setWarmupComplete(true);
    }, POLYMARKET_STARTUP_GRACE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

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
      }, POLYMARKET_LIVE_POLL_MS);
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimeout !== null || document.hidden) return;
      reconnectTimeout = window.setTimeout(() => {
        reconnectTimeout = null;
        connect();
      }, POLYMARKET_LIVE_STREAM_RETRY_MS);
    };

    const connect = () => {
      if (stopped || source || document.hidden || typeof EventSource === "undefined") return;

      try {
        source = new EventSource("/api/trading-ops/polymarket/live/stream");
        source.addEventListener("snapshot", (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data) as TradingOpsPolymarketLiveData;
            apply(payload);
            stopFallback();
          } catch {
            setError("Polymarket live stream payload could not be parsed.");
          }
        });
        source.addEventListener("warning", (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data) as { message?: string };
            setError(payload.message ?? "Polymarket live stream warning");
          } catch {
            setError("Polymarket live stream warning");
          }
        });
        source.onerror = () => {
          disconnect();
          setError((current) => current ?? "Polymarket live stream reconnecting. Falling back to snapshots.");
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

  return {
    data,
    error,
    lastSuccessfulAt,
    warmupComplete,
    pinPendingSlugs,
    mutatePin,
  };
}
