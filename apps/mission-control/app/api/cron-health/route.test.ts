import { describe, expect, it } from "vitest";
import {
  parseCronIntervalMs,
  getExpectedIntervalMs,
  normalizeStatus,
  toScheduleText,
} from "@/app/api/cron-health/route";

describe("parseCronIntervalMs", () => {
  it("parses minute step expressions", () => {
    expect(parseCronIntervalMs("*/5 * * * *")).toBe(5 * 60_000);
  });

  it("parses hourly expressions with fixed minute", () => {
    expect(parseCronIntervalMs("0 * * * *")).toBe(3_600_000);
  });

  it("parses daily/weekly-ish expressions", () => {
    expect(parseCronIntervalMs("0 0 * * *")).toBe(86_400_000);
    expect(parseCronIntervalMs("0 9 * * 1")).toBe(7 * 86_400_000);
  });

  it("returns null when expression is missing", () => {
    expect(parseCronIntervalMs(undefined)).toBeNull();
    expect(parseCronIntervalMs(null)).toBeNull();
  });
});

describe("getExpectedIntervalMs", () => {
  it("uses schedule.everyMs for every schedules", () => {
    expect(getExpectedIntervalMs({ kind: "every", everyMs: 120_000 })).toBe(120_000);
  });

  it("uses parsed cron interval for cron schedules", () => {
    expect(getExpectedIntervalMs({ kind: "cron", expr: "*/10 * * * *" })).toBe(10 * 60_000);
  });

  it("returns null for at schedules", () => {
    expect(getExpectedIntervalMs({ kind: "at", at: "2026-01-01T00:00:00.000Z" })).toBeNull();
  });
});

describe("normalizeStatus", () => {
  it("marks failed-like statuses as failed", () => {
    expect(normalizeStatus("failed", 0, false)).toBe("failed");
    expect(normalizeStatus("timeout", 0, false)).toBe("failed");
  });

  it("marks nonzero failures as failed", () => {
    expect(normalizeStatus("completed", 1, false)).toBe("failed");
  });

  it("marks late when no failure signal exists", () => {
    expect(normalizeStatus("completed", 0, true)).toBe("late");
  });

  it("marks healthy when no failures and not late", () => {
    expect(normalizeStatus("completed", 0, false)).toBe("healthy");
    expect(normalizeStatus(undefined, 0, false)).toBe("healthy");
  });
});

describe("toScheduleText", () => {
  it("formats cron schedules", () => {
    expect(toScheduleText({ kind: "cron", expr: "*/15 * * * *" })).toBe("*/15 * * * *");
  });

  it("formats every schedules in minutes", () => {
    expect(toScheduleText({ kind: "every", everyMs: 5 * 60_000 })).toBe("every 5m");
    expect(toScheduleText({ kind: "every", everyMs: 0 })).toBe("every");
  });

  it("formats at schedules and handles missing schedule", () => {
    expect(toScheduleText({ kind: "at", at: "2026-01-01T00:00:00.000Z" })).toBe(
      "at 2026-01-01T00:00:00.000Z"
    );
    expect(toScheduleText()).toBe("—");
  });
});
