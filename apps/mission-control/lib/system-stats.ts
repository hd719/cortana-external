export type HealthStatus = "healthy" | "degraded" | "critical" | "idle" | "unknown";

export type HeartbeatStatus = "healthy" | "stale" | "missed" | "quiet" | "unknown";

export type SessionSummary = {
  active: number;
  recent: number;
  stale: number;
  aborted: number;
  lastUpdated: number | null;
};

export type HealthBadgeVariant =
  | "success"
  | "warning"
  | "destructive"
  | "secondary"
  | "outline";

export const SESSION_RECENT_MS = 30 * 60 * 1000;
export const SESSION_STALE_MS = 2 * 60 * 60 * 1000;

const HEALTH_RANK: Record<HealthStatus, number> = {
  healthy: 0,
  idle: 1,
  unknown: 2,
  degraded: 3,
  critical: 4,
};

const worstHealth = (...statuses: HealthStatus[]) =>
  statuses.reduce((worst, next) => (HEALTH_RANK[next] > HEALTH_RANK[worst] ? next : worst), "healthy");

export function heartbeatStatusLabel(status: HeartbeatStatus | null): string {
  switch (status) {
    case "healthy":
      return "Live";
    case "stale":
      return "Stale";
    case "missed":
      return "Missed";
    case "quiet":
      return "Quiet hours";
    default:
      return "Unknown";
  }
}

export function heartbeatStatusVariant(status: HeartbeatStatus | null): HealthBadgeVariant {
  switch (status) {
    case "healthy":
      return "success";
    case "stale":
      return "warning";
    case "missed":
      return "destructive";
    case "quiet":
      return "secondary";
    default:
      return "outline";
  }
}

export function healthStatusLabel(status: HealthStatus): string {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "degraded":
      return "Degraded";
    case "critical":
      return "Critical";
    case "idle":
      return "Idle";
    default:
      return "Unknown";
  }
}

export function healthStatusVariant(status: HealthStatus): HealthBadgeVariant {
  switch (status) {
    case "healthy":
      return "success";
    case "degraded":
      return "warning";
    case "critical":
      return "destructive";
    case "idle":
      return "secondary";
    default:
      return "outline";
  }
}

export function formatAge(ageMs: number | null): string {
  if (ageMs == null || !Number.isFinite(ageMs)) return "never";
  const totalMinutes = Math.max(0, Math.floor(ageMs / 60_000));
  if (totalMinutes < 1) return "just now";
  if (totalMinutes < 60) return `${totalMinutes}m ago`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins === 0 ? `${hours}h ago` : `${hours}h ${mins}m ago`;
}

export function summarizeSessions(
  sessions: Array<{ updatedAt: number | null; abortedLastRun: boolean | null }>,
  now = Date.now(),
  recentWindowMs = SESSION_RECENT_MS,
  staleWindowMs = SESSION_STALE_MS
): SessionSummary {
  let recent = 0;
  let stale = 0;
  let aborted = 0;
  let lastUpdated: number | null = null;

  sessions.forEach((session) => {
    const updatedAt = typeof session.updatedAt === "number" ? session.updatedAt : null;
    const ageMs = updatedAt == null ? null : Math.max(0, now - updatedAt);

    if (session.abortedLastRun) aborted += 1;

    if (ageMs != null && ageMs <= recentWindowMs) {
      recent += 1;
    } else if (ageMs == null || ageMs >= staleWindowMs) {
      stale += 1;
    }

    if (updatedAt != null && (lastUpdated == null || updatedAt > lastUpdated)) {
      lastUpdated = updatedAt;
    }
  });

  return {
    active: sessions.length,
    recent,
    stale,
    aborted,
    lastUpdated,
  };
}

export function deriveHostHealth(input: {
  heartbeat: HeartbeatStatus | null;
  postgres: boolean | null;
  lancedb: boolean | null;
}): HealthStatus {
  const heartbeat = input.heartbeat;
  const heartbeatHealth: HealthStatus =
    heartbeat === "missed"
      ? "critical"
      : heartbeat === "stale"
        ? "degraded"
        : heartbeat === "unknown" || heartbeat == null
          ? "unknown"
          : "healthy";

  const dbHealth: HealthStatus =
    input.postgres === false
      ? "critical"
      : input.lancedb === false
        ? "degraded"
        : input.postgres == null || input.lancedb == null
          ? "unknown"
          : "healthy";

  return worstHealth(heartbeatHealth, dbHealth);
}

export function deriveGatewayHealth(input: {
  heartbeat: HeartbeatStatus | null;
  idle: boolean | null;
}): HealthStatus {
  const heartbeat = input.heartbeat;
  if (heartbeat === "missed") return "critical";
  if (heartbeat === "stale") return "degraded";
  if (heartbeat === "unknown" || heartbeat == null) return "unknown";
  return input.idle ? "idle" : "healthy";
}

export function deriveSessionHealth(summary: SessionSummary): HealthStatus {
  if (summary.active === 0) return "idle";
  if (summary.aborted > 0) return "degraded";
  if (summary.stale > 0) return "degraded";
  if (summary.recent > 0) return "healthy";
  return "unknown";
}
