import { describe, expect, it } from "vitest";
import {
  isStoreRunActive,
  launchPhaseFromLifecycle,
  lifecycleEventFromStoreRun,
  lifecycleStatusFromStoreRun,
  normalizeLifecycleStatus,
  runStatusFromLifecycle,
} from "@/lib/openclaw-lifecycle";

describe("lib/openclaw-lifecycle", () => {
  it("normalizes lifecycle aliases into canonical states", () => {
    expect(normalizeLifecycleStatus("complete")).toBe("done");
    expect(normalizeLifecycleStatus("ok")).toBe("done");
    expect(normalizeLifecycleStatus("cancelled")).toBe("killed");
    expect(normalizeLifecycleStatus("error")).toBe("failed");
    expect(normalizeLifecycleStatus("mystery")).toBeNull();
  });

  it("maps lifecycle states to run states", () => {
    expect(runStatusFromLifecycle("done")).toBe("completed");
    expect(runStatusFromLifecycle("timeout")).toBe("failed");
    expect(runStatusFromLifecycle("killed")).toBe("cancelled");
  });

  it("derives launch phases from lifecycle transitions", () => {
    expect(launchPhaseFromLifecycle("queued")).toBe("phase1_queued");
    expect(launchPhaseFromLifecycle("running", "queued")).toBe("phase2_running_confirmed");
    expect(launchPhaseFromLifecycle("running", "done")).toBe("phase2_running_unconfirmed");
    expect(launchPhaseFromLifecycle("done")).toBe("terminal");
  });

  it("converts OpenClaw run store records into lifecycle events", () => {
    const event = lifecycleEventFromStoreRun({
      runId: "run-1",
      label: "research",
      startedAt: 1700000000000,
      endedAt: 1700000001000,
      outcome: { status: "ok" },
      agent: "codex",
      role: "worker",
      endedReason: "finished",
    });

    expect(event).toMatchObject({
      runId: "run-1",
      status: "done",
      agentName: "codex",
      role: "worker",
      jobType: "research",
      timestamp: "2023-11-14T22:13:21.000Z",
    });
    expect(event?.summary).toContain("finished");
    expect(event?.metadata).toMatchObject({
      source: "openclaw-runs-store",
      outcome: { status: "ok" },
    });
  });

  it("tracks active store runs independently from terminal status", () => {
    expect(isStoreRunActive({ runId: "active", startedAt: 1 })).toBe(true);
    expect(isStoreRunActive({ runId: "done", startedAt: 1, endedAt: 2 })).toBe(false);
    expect(lifecycleStatusFromStoreRun({ runId: "queued" })).toBe("queued");
    expect(lifecycleStatusFromStoreRun({ runId: "running", startedAt: 1 })).toBe("running");
  });
});
