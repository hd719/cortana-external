"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useRef, useState } from "react";
import { preferredFlashMark } from "@/lib/trading-ops/polymarket-helpers";

export function usePolymarketFlashClass(values: {
  bid: number | null;
  ask: number | null;
  last: number | null;
  spread: number | null;
}): string {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prevRef = useRef(values);
  const timerRef = useRef(0);

  useEffect(() => {
    const previous = prevRef.current;
    prevRef.current = values;
    if (!previous) return;

    const currentMark = preferredFlashMark(values);
    const previousMark = preferredFlashMark(previous);
    if (currentMark == null || previousMark == null || currentMark === previousMark) {
      if (
        previous.bid !== values.bid ||
        previous.ask !== values.ask ||
        previous.last !== values.last ||
        previous.spread !== values.spread
      ) {
        setFlash("up");
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setFlash(null), 1100);
      }
      return;
    }

    setFlash(currentMark > previousMark ? "up" : "down");
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setFlash(null), 1100);
  }, [values]);

  if (flash === "up") return "bg-emerald-500/14 border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.22)]";
  if (flash === "down") return "bg-red-500/12 border-red-500/35 shadow-[0_0_0_1px_rgba(239,68,68,0.18)]";
  return "";
}
