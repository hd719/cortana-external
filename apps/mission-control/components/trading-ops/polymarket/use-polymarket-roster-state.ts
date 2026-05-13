"use client";

import { useEffect, useRef, useState } from "react";
import type { TradingOpsPolymarketLiveData } from "@/lib/trading-ops-contract";

export function usePolymarketRosterState(
  rows: TradingOpsPolymarketLiveData["markets"],
  updatedAt: string | null,
) {
  const [newSlugs, setNewSlugs] = useState<string[]>([]);
  const [badgeLabel, setBadgeLabel] = useState<string | null>(null);
  const [highlightedUpdatedAt, setHighlightedUpdatedAt] = useState<string | null>(null);
  const [leaderChanged, setLeaderChanged] = useState(false);
  const previousSlugsRef = useRef<string[] | null>(null);
  const previousLeaderRef = useRef<string | null>(null);
  const newTimerRef = useRef(0);
  const badgeTimerRef = useRef(0);

  useEffect(() => {
    return () => {
      window.clearTimeout(newTimerRef.current);
      window.clearTimeout(badgeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const currentSlugs = rows.map((row) => row.slug);
    const currentLeader = rows[0]?.slug ?? null;
    const previousSlugs = previousSlugsRef.current;
    const previousLeader = previousLeaderRef.current;

    previousSlugsRef.current = currentSlugs;
    previousLeaderRef.current = currentLeader;

    if (!previousSlugs) return;

    const previousSet = new Set(previousSlugs);
    const currentSet = new Set(currentSlugs);
    const entering = currentSlugs.filter((slug) => !previousSet.has(slug));
    const leaving = previousSlugs.filter((slug) => !currentSet.has(slug));
    const membershipChanged = entering.length > 0 || leaving.length > 0;
    const hasLeaderChange = Boolean(previousLeader && currentLeader && previousLeader !== currentLeader);

    if (!membershipChanged && !hasLeaderChange) {
      return;
    }

    if (entering.length > 0) {
      setNewSlugs((current) => Array.from(new Set([...current, ...entering])));
      window.clearTimeout(newTimerRef.current);
      newTimerRef.current = window.setTimeout(() => setNewSlugs([]), 10_000);
    }

    setLeaderChanged(hasLeaderChange);
    setHighlightedUpdatedAt(updatedAt);
    setBadgeLabel(entering.length > 0 ? `${entering.length} new` : "updated");
    window.clearTimeout(badgeTimerRef.current);
    badgeTimerRef.current = window.setTimeout(() => {
      setBadgeLabel(null);
      setHighlightedUpdatedAt(null);
      setLeaderChanged(false);
    }, 8_000);
  }, [rows, updatedAt]);

  return {
    newSlugs: new Set(newSlugs),
    badgeLabel,
    updatedAt: highlightedUpdatedAt,
    leaderChanged,
  };
}
