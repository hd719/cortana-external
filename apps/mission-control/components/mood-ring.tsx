"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type MoodState = "nominal" | "heavy_load" | "completed" | "self_healing";

type MoodPayload = {
  ok: boolean;
  mood: MoodState;
};

const POLL_MS = 30_000;

const moodStyles: Record<MoodState, { ring: string; glow: string }> = {
  nominal: {
    ring: "rgba(56, 189, 248, 0.9)",
    glow: "rgba(56, 189, 248, 0.45)",
  },
  heavy_load: {
    ring: "rgba(251, 146, 60, 0.95)",
    glow: "rgba(251, 146, 60, 0.48)",
  },
  completed: {
    ring: "rgba(74, 222, 128, 0.95)",
    glow: "rgba(74, 222, 128, 0.5)",
  },
  self_healing: {
    ring: "rgba(248, 113, 113, 0.95)",
    glow: "rgba(248, 113, 113, 0.52)",
  },
};

export function MoodRing() {
  const [mood, setMood] = useState<MoodState>("nominal");

  const fetchMood = useCallback(async () => {
    try {
      const res = await fetch("/api/system-mood", { cache: "no-store" });
      if (!res.ok) return;

      const payload = (await res.json()) as MoodPayload;
      if (payload.mood) setMood(payload.mood);
    } catch {
      // Keep last known mood; ambient should never hard-fail the UI.
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(fetchMood, 50);
    const interval = window.setInterval(fetchMood, POLL_MS);

    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [fetchMood]);

  const style = useMemo(() => {
    const colors = moodStyles[mood];
    return {
      borderColor: colors.ring,
      boxShadow: `0 0 24px 4px ${colors.glow}, inset 0 0 18px 2px ${colors.glow}`,
      background:
        "radial-gradient(circle at center, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.01) 50%, transparent 70%)",
    };
  }, [mood]);

  const moodLabel = mood.replaceAll("_", " ");

  return (
    <div className="flex h-full flex-col justify-center rounded-lg border bg-card/60 px-3 py-2 shadow-sm">
      <div className="flex items-center gap-3">
        <div
          aria-label={`System mood: ${moodLabel}`}
          title={`System mood: ${moodLabel}`}
          className="relative h-8 w-8 shrink-0 rounded-full border-2 transition-[border-color,box-shadow,filter] duration-700 ease-in-out"
          style={style}
        >
          <span
            aria-hidden="true"
            className="absolute inset-0.5 rounded-full border border-white/20 opacity-70"
          />
          <span
            aria-hidden="true"
            className="absolute -inset-1.5 rounded-full blur-lg transition-colors duration-700"
            style={{ backgroundColor: moodStyles[mood].glow }}
          />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground capitalize">{moodLabel}</p>
          <p className="text-xs text-muted-foreground">System mood</p>
        </div>
      </div>
    </div>
  );
}
