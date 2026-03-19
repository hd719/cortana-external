import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, beforeEach } from "vitest";

import { createLogger } from "../lib/logger.js";
import { AppleHealthService } from "../apple-health/service.js";
import { ensureDataDir, saveLatestPayload, appendToHistory, loadLatestPayload } from "../apple-health/store.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apple-health-"));
}

const logger = createLogger("apple-health-test", () => {});

function makeTestPayload() {
  return {
    type: "health_test" as const,
    deviceId: "ABC123",
    deviceName: "iPhone 15",
    sentAt: "2026-03-19T10:00:00.000Z",
    message: "hello from phone",
  };
}

function makeSyncPayload() {
  return {
    type: "health_sync" as const,
    deviceId: "ABC123",
    deviceName: "iPhone 15",
    sentAt: "2026-03-19T10:00:00.000Z",
    range: {
      start: "2026-03-18T00:00:00.000Z",
      end: "2026-03-19T00:00:00.000Z",
    },
    metrics: {
      steps: { total: 8500 },
      sleep: { totalHours: 7.5 },
      restingHeartRate: { average: 62 },
      workouts: [
        {
          activityType: "running",
          start: "2026-03-18T07:00:00.000Z",
          end: "2026-03-18T07:45:00.000Z",
          durationMinutes: 45,
        },
      ],
    },
    appVersion: "1.0.0",
  };
}

describe("apple-health store", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = createTempDir();
  });

  it("ensureDataDir creates directory recursively", async () => {
    const nested = path.join(dataDir, "nested", "dir");
    await ensureDataDir(nested);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it("saveLatestPayload and loadLatestPayload round-trip", async () => {
    const payload = makeTestPayload();
    await saveLatestPayload(dataDir, payload);
    const loaded = await loadLatestPayload(dataDir);
    expect(loaded).toEqual(payload);
  });

  it("appendToHistory appends NDJSON lines", async () => {
    await appendToHistory(dataDir, { a: 1 });
    await appendToHistory(dataDir, { b: 2 });

    const content = fs.readFileSync(path.join(dataDir, "history.ndjson"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ a: 1 });
    expect(JSON.parse(lines[1])).toEqual({ b: 2 });
  });

  it("loadLatestPayload throws when file missing", async () => {
    await expect(loadLatestPayload(dataDir)).rejects.toThrow();
  });
});

describe("AppleHealthService", () => {
  let dataDir: string;
  let service: AppleHealthService;

  beforeEach(() => {
    dataDir = createTempDir();
    service = new AppleHealthService({
      token: "test-token-123",
      dataDir,
      logger,
    });
  });

  describe("validateToken", () => {
    it("returns true for valid Bearer token", () => {
      expect(service.validateToken("Bearer test-token-123")).toBe(true);
    });

    it("returns false for wrong token", () => {
      expect(service.validateToken("Bearer wrong-token")).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(service.validateToken(undefined)).toBe(false);
    });

    it("returns false for missing Bearer prefix", () => {
      expect(service.validateToken("test-token-123")).toBe(false);
    });
  });

  describe("handleTest", () => {
    it("validates and stores test payload", async () => {
      const result = await service.handleTest(makeTestPayload());
      expect(result.ok).toBe(true);
      expect(result.stored).toBe(true);
      expect(result.receivedAt).toBeTruthy();

      const stored = await loadLatestPayload(dataDir);
      expect(stored).toEqual(makeTestPayload());
    });

    it("rejects invalid payload", async () => {
      await expect(service.handleTest({ type: "wrong" })).rejects.toThrow();
    });
  });

  describe("handleSync", () => {
    it("validates, stores latest, and appends history", async () => {
      const result = await service.handleSync(makeSyncPayload());
      expect(result.ok).toBe(true);
      expect(result.stored).toBe(true);

      const stored = await loadLatestPayload(dataDir);
      expect(stored).toEqual(makeSyncPayload());

      const history = fs.readFileSync(path.join(dataDir, "history.ndjson"), "utf-8");
      const lines = history.trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toEqual(makeSyncPayload());
    });

    it("rejects invalid sync payload", async () => {
      await expect(service.handleSync({ type: "health_sync" })).rejects.toThrow();
    });
  });

  describe("getHealth", () => {
    it("returns inactive when no data stored", async () => {
      const health = await service.getHealth();
      expect(health.status).toBe("inactive");
    });

    it("returns healthy with lastSyncAt after storing data", async () => {
      await service.handleTest(makeTestPayload());
      const health = await service.getHealth();
      expect(health.status).toBe("healthy");
      expect(health.lastSyncAt).toBe("2026-03-19T10:00:00.000Z");
    });
  });
});
