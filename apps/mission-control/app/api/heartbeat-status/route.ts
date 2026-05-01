import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import {
  getHeartbeatRuntimeSessionKey,
  getHeartbeatRuntimeSessionPath,
  getHeartbeatStatePath,
} from "@/lib/runtime-paths";

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

type RuntimeHeartbeatSignal = {
  timestampMs: number;
  source: string;
};

export function normalizeTimestamp(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw < 1_000_000_000_000 ? raw * 1000 : raw;
}

export function resolveLatestHeartbeat(parsed: HeartbeatState, runtimeSignal: RuntimeHeartbeatSignal | null = null): number | null {
  const direct = normalizeTimestamp(parsed.lastHeartbeat);
  let latest: number | null = runtimeSignal?.timestampMs ?? null;

  if (direct != null && (latest == null || direct > latest)) latest = direct;

  if (parsed.lastChecks && typeof parsed.lastChecks === "object") {
    for (const check of Object.values(parsed.lastChecks)) {
      const ts = normalizeTimestamp(check?.lastChecked);
      if (ts != null && (latest == null || ts > latest)) latest = ts;
    }
  }

  return latest;
}

export function readRuntimeHeartbeatSignalFromSessions(
  raw: string,
  sessionKey = "agent:main:main",
  nowMs = Date.now()
): RuntimeHeartbeatSignal | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const session = (parsed as Record<string, unknown>)[sessionKey];
    if (!session || typeof session !== "object" || Array.isArray(session)) return null;

    const updatedAt = (session as Record<string, unknown>).updatedAt;
    if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return null;
    const timestampMs = Math.trunc(updatedAt);
    if (timestampMs <= 0 || timestampMs > nowMs + 5 * 60 * 1000) return null;

    return { timestampMs, source: `openclawSessions.${sessionKey}` };
  } catch {
    return null;
  }
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

async function readRuntimeHeartbeatSignal(): Promise<RuntimeHeartbeatSignal | null> {
  try {
    const raw = await readFile(getHeartbeatRuntimeSessionPath(), "utf8");
    return readRuntimeHeartbeatSignalFromSessions(raw, getHeartbeatRuntimeSessionKey());
  } catch {
    return null;
  }
}

function heartbeatResponse(lastHeartbeat: number | null, source: string | null, ok: boolean) {
  const ageMs = lastHeartbeat == null ? null : Math.max(0, Date.now() - lastHeartbeat);
  return NextResponse.json(
    {
      ok,
      lastHeartbeat,
      ageMs,
      status: getStatus(ageMs),
      source,
    },
    {
      status: 200,
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    }
  );
}

export async function GET() {
  const runtimeSignal = await readRuntimeHeartbeatSignal();
  try {
    const raw = await readFile(getHeartbeatStatePath(), "utf8");
    const parsed = JSON.parse(raw) as HeartbeatState;
    const lastHeartbeat = resolveLatestHeartbeat(parsed, runtimeSignal);
    const source = lastHeartbeat === runtimeSignal?.timestampMs ? runtimeSignal.source : "heartbeat-state";
    return heartbeatResponse(lastHeartbeat, source, true);
  } catch {
    if (runtimeSignal) return heartbeatResponse(runtimeSignal.timestampMs, runtimeSignal.source, true);
    return heartbeatResponse(null, null, false);
  }
}
