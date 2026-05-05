import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getAutonomyOpsSnapshot, parseAutonomyOpsArtifact } from "@/lib/autonomy-ops";

function artifact(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    schemaVersion: "autonomy-ops.v1",
    generatedAt: "2026-05-05T12:00:00.000Z",
    freshUntil: "2026-05-05T12:10:00.000Z",
    operatorState: "live",
    posture: "balanced",
    stale: false,
    counts: { autoRemediated: 0, escalated: 0, needsHuman: 0, actionable: 0, suppressed: 0 },
    sections: {
      autoFixed: [],
      degraded: [],
      waitingOnHamel: [],
      blockers: [],
      familyCritical: { tracked: [], failures: 0, stricterEscalation: true },
      scorecard: { counts: {}, activeFollowUps: [] },
    },
    sources: [{ key: "autonomy_status", label: "Autonomy status", required: true, status: "fresh", confidence: "high", generatedAt: "2026-05-05T12:00:00.000Z", freshUntil: "2026-05-05T12:10:00.000Z", detail: null }],
    ...extra,
  });
}

describe("autonomy ops artifact reader", () => {
  it("parses a fresh v1 artifact", () => {
    const parsed = parseAutonomyOpsArtifact(artifact(), new Date("2026-05-05T12:05:00.000Z"));
    expect(parsed.stale).toBe(false);
    expect(parsed.data.operatorState).toBe("live");
    expect(parsed.data.sources).toHaveLength(1);
  });

  it("marks an expired artifact as stale", () => {
    const parsed = parseAutonomyOpsArtifact(artifact(), new Date("2026-05-05T12:11:00.000Z"));
    expect(parsed.stale).toBe(true);
    expect(parsed.data.stale).toBe(true);
  });

  it("rejects live posture when a required source is stale", () => {
    expect(() => parseAutonomyOpsArtifact(artifact({
      sources: [{ key: "autonomy_status", label: "Autonomy status", required: true, status: "stale", confidence: "low", generatedAt: "2026-05-05T12:00:00.000Z", freshUntil: "2026-05-05T12:01:00.000Z", detail: "old" }],
    }))).toThrow(/live state/);
  });

  it("returns unavailable shape when the artifact is missing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "autonomy-ops-missing-"));
    vi.stubEnv("AUTONOMY_OPS_ARTIFACT_PATH", path.join(root, "missing.json"));
    const snapshot = getAutonomyOpsSnapshot();
    expect(snapshot.ok).toBe(false);
    expect(snapshot.stale).toBe(true);
    vi.unstubAllEnvs();
  });
});
