"use client";

import { useCallback, useEffect, useState } from "react";
import type { TradingOpsPolymarketData } from "@/lib/trading-ops-contract";
import { isPolymarketPayload } from "@/lib/trading-ops/polymarket-helpers";

const POLYMARKET_POLL_MS = 30_000;

export type UsePolymarketStatusResult = {
  data: TradingOpsPolymarketData | null;
  error: string | null;
  refetch: () => Promise<void>;
};

export function usePolymarketStatus(): UsePolymarketStatusResult {
  const [data, setData] = useState<TradingOpsPolymarketData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const response = await fetch("/api/trading-ops/polymarket", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Polymarket route failed (${response.status})`);
      }
      const payload = (await response.json()) as unknown;
      if (!isPolymarketPayload(payload)) {
        throw new Error("Polymarket route returned an invalid payload");
      }
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Polymarket route failed");
    }
  }, []);

  useEffect(() => {
    const run = () => {
      if (document.hidden) return;
      void refetch();
    };

    run();
    const intervalId = window.setInterval(run, POLYMARKET_POLL_MS);

    const handleVisibility = () => {
      if (!document.hidden) {
        run();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refetch]);

  return { data, error, refetch };
}
