import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";

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

const HEARTBEAT_FILE = "/Users/hd/clawd/memory/heartbeat-state.json";

export function normalizeTimestamp(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw < 1_000_000_000_000 ? raw * 1000 : raw;
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
    const raw = await readFile(HEARTBEAT_FILE, "utf8");
    const parsed = JSON.parse(raw) as { lastHeartbeat?: unknown; lastChecks?: Record<string, { lastChecked?: unknown }> };

    // Try direct lastHeartbeat first, fall back to most recent lastChecks entry (v2 format)
    let lastHeartbeat = normalizeTimestamp(parsed.lastHeartbeat);
    if (lastHeartbeat == null && parsed.lastChecks && typeof parsed.lastChecks === "object") {
      let latest: number | null = null;
      for (const check of Object.values(parsed.lastChecks)) {
        const ts = normalizeTimestamp(check?.lastChecked);
        if (ts != null && (latest == null || ts > latest)) latest = ts;
      }
      lastHeartbeat = latest;
    }
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
