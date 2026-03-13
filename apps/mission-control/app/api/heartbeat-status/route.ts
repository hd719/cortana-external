import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getHeartbeatStatePath } from "@/lib/runtime-paths";

export type HeartbeatStatus = "healthy" | "stale" | "missed" | "quiet" | "unknown";

// Heartbeat quiet hours: 23:00–06:00 ET (no heartbeats expected)
const QUIET_START = 23;
const QUIET_END = 6;

function isQuietHours(): boolean {
  const now = new Date();
  const etHour = parseInt(
    now.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" })
  );
  return etHour >= QUIET_START || etHour < QUIET_END;
}

type HeartbeatState = {
  lastHeartbeat?: unknown;
  lastChecks?: Record<string, { lastChecked?: unknown }>;
};

export function normalizeTimestamp(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw < 1_000_000_000_000 ? raw * 1000 : raw;
}

export function resolveLatestHeartbeat(parsed: HeartbeatState): number | null {
  const direct = normalizeTimestamp(parsed.lastHeartbeat);
  let fromChecks: number | null = null;

  if (parsed.lastChecks && typeof parsed.lastChecks === "object") {
    for (const check of Object.values(parsed.lastChecks)) {
      const ts = normalizeTimestamp(check?.lastChecked);
      if (ts != null && (fromChecks == null || ts > fromChecks)) fromChecks = ts;
    }
  }

  if (direct == null) return fromChecks;
  if (fromChecks == null) return direct;
  return Math.max(direct, fromChecks);
}

export function getStatus(ageMs: number | null): HeartbeatStatus {
  if (ageMs == null) return "unknown";
  if (ageMs < 90 * 60 * 1000) return "healthy";
  if (ageMs <= 3 * 60 * 60 * 1000) return "stale";
  if (isQuietHours()) return "quiet";
  return "missed";
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const raw = await readFile(getHeartbeatStatePath(), "utf8");
    const parsed = JSON.parse(raw) as HeartbeatState;
    const lastHeartbeat = resolveLatestHeartbeat(parsed);
    const ageMs = lastHeartbeat == null ? null : Math.max(0, Date.now() - lastHeartbeat);

    return NextResponse.json(
      {
        ok: true,
        lastHeartbeat,
        ageMs,
        status: getStatus(ageMs),
      },
      {
        headers: {
          "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      }
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        lastHeartbeat: null,
        ageMs: null,
        status: "unknown",
      },
      {
        status: 200,
        headers: {
          "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      }
    );
  }
}
