import { describe, expect, it, vi, afterEach } from "vitest";
import { computeHealthScore, deriveHealthBand } from "@/lib/agent-health";

afterEach(() => {
  vi.useRealTimers();
});

describe("deriveHealthBand", () => {
  it("maps high scores to healthy", () => {
    expect(deriveHealthBand(75)).toBe("healthy");
    expect(deriveHealthBand(99)).toBe("healthy");
  });

  it("maps mid scores to degraded", () => {
    expect(deriveHealthBand(45)).toBe("degraded");
    expect(deriveHealthBand(74.9)).toBe("degraded");
  });

  it("maps low scores to critical", () => {
    expect(deriveHealthBand(44.9)).toBe("critical");
  });
});

describe("computeHealthScore", () => {
  it("returns baseline score when no run/task history exists", () => {
    const score = computeHealthScore({
      completedRuns: 0,
      failedRuns: 0,
      cancelledRuns: 0,
      completedTasks: 0,
      failedTasks: 0,
    });

    expect(score).toBeCloseTo(42, 5);
  });

  it("returns a high score for all successful runs/tasks", () => {
    const score = computeHealthScore({
      completedRuns: 20,
      failedRuns: 0,
      cancelledRuns: 0,
      completedTasks: 40,
      failedTasks: 0,
    });

    expect(score).toBeGreaterThan(90);
  });

  it("returns a degraded score for mixed success/failure history", () => {
    const score = computeHealthScore({
      completedRuns: 8,
      failedRuns: 6,
      cancelledRuns: 2,
      completedTasks: 10,
      failedTasks: 6,
    });

    expect(score).toBeGreaterThan(45);
    expect(score).toBeLessThan(75);
    expect(deriveHealthBand(score)).toBe("degraded");
  });

  it("weights recent failures more heavily than old failures", () => {
    const fixedNow = new Date("2026-02-26T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const baseStats = {
      completedRuns: 40,
      failedRuns: 5,
      cancelledRuns: 0,
      completedTasks: 60,
      failedTasks: 8,
    };

    const recentFailures = computeHealthScore(baseStats, [
      { status: "failed", timestamp: fixedNow.getTime() - 60 * 60 * 1000 },
      { status: "failed", timestamp: fixedNow.getTime() - 2 * 60 * 60 * 1000 },
      { status: "completed", timestamp: fixedNow.getTime() - 3 * 60 * 60 * 1000 },
    ]);

    const oldFailuresOutsideWindow = computeHealthScore(baseStats, [
      { status: "failed", timestamp: fixedNow.getTime() - 10 * 24 * 60 * 60 * 1000 },
      { status: "failed", timestamp: fixedNow.getTime() - 20 * 24 * 60 * 60 * 1000 },
      { status: "completed", timestamp: fixedNow.getTime() - 30 * 24 * 60 * 60 * 1000 },
    ]);

    expect(recentFailures).toBeLessThan(oldFailuresOutsideWindow);
  });

  it("treats null/empty recent run arrays and invalid timestamps safely", () => {
    const stats = {
      completedRuns: 5,
      failedRuns: 1,
      cancelledRuns: 0,
      completedTasks: 7,
      failedTasks: 1,
    };

    const withEmpty = computeHealthScore(stats, []);
    const withNullRecent = computeHealthScore(stats, null as unknown as []);
    const withInvalidTimestamps = computeHealthScore(stats, [
      { status: "failed", timestamp: Number.NaN },
      { status: "completed", timestamp: "not-a-date" },
    ]);

    expect(withEmpty).toBeCloseTo(withNullRecent, 5);
    expect(withEmpty).toBeCloseTo(withInvalidTimestamps, 5);
  });
});
