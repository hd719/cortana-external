"use client";

import { usePolledFetch } from "./use-polled-fetch";

export type TodayStatsPayload = {
  source: "cortana" | "app";
  generatedAt: string;
  metrics: {
    subagentsSpawnedToday: number;
    runsCompletedToday: number;
    selfHealsToday: number;
    activeRunsNow: number;
  };
};

export function useTodayStats() {
  return usePolledFetch<TodayStatsPayload>("/api/today-stats", 45_000);
}
