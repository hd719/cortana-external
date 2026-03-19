import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Hono } from "hono";
import { describe, expect, it, beforeEach } from "vitest";

import { createLogger } from "../lib/logger.js";
import { createAppleHealthRouter } from "../apple-health/routes.js";
import { AppleHealthService } from "../apple-health/service.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apple-health-routes-"));
}

const logger = createLogger("apple-health-test", () => {});

function makeTestPayload() {
  return {
    type: "health_test",
    deviceId: "ABC123",
    deviceName: "iPhone 15",
    sentAt: "2026-03-19T10:00:00.000Z",
    message: "hello from phone",
  };
}

function makeSyncPayload() {
  return {
    type: "health_sync",
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

function createTestApp(dataDir: string, token = "test-token-123") {
  const service = new AppleHealthService({ token, dataDir, logger });
  const app = new Hono();
  app.route("/", createAppleHealthRouter(service));
  return { app, service };
}

describe("apple-health routes", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = createTempDir();
  });

  describe("GET /apple-health/health", () => {
    it("returns inactive when no data", async () => {
      const { app } = createTestApp(dataDir);
      const response = await app.request("/apple-health/health");
      expect(response.status).toBe(200);
      const body = (await response.json()) as { status: string };
      expect(body.status).toBe("inactive");
    });

    it("returns healthy after data is stored", async () => {
      const { app } = createTestApp(dataDir);

      await app.request("/apple-health/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token-123",
        },
        body: JSON.stringify(makeTestPayload()),
      });

      const response = await app.request("/apple-health/health");
      expect(response.status).toBe(200);
      const body = (await response.json()) as { status: string; lastSyncAt: string };
      expect(body.status).toBe("healthy");
      expect(body.lastSyncAt).toBe("2026-03-19T10:00:00.000Z");
    });

    it("does not require auth", async () => {
      const { app } = createTestApp(dataDir);
      const response = await app.request("/apple-health/health");
      expect(response.status).toBe(200);
    });
  });

  describe("POST /apple-health/test", () => {
    it("returns 401 without auth header", async () => {
      const { app } = createTestApp(dataDir);
      const response = await app.request("/apple-health/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTestPayload()),
      });
      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("unauthorized");
    });

    it("returns 401 with wrong token", async () => {
      const { app } = createTestApp(dataDir);
      const response = await app.request("/apple-health/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong-token",
        },
        body: JSON.stringify(makeTestPayload()),
      });
      expect(response.status).toBe(401);
    });

    it("stores valid test payload", async () => {
      const { app } = createTestApp(dataDir);
      const response = await app.request("/apple-health/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token-123",
        },
        body: JSON.stringify(makeTestPayload()),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { ok: boolean; stored: boolean };
      expect(body.ok).toBe(true);
      expect(body.stored).toBe(true);

      const stored = JSON.parse(fs.readFileSync(path.join(dataDir, "latest.json"), "utf-8"));
      expect(stored.type).toBe("health_test");
    });

    it("returns 400 for invalid payload", async () => {
      const { app } = createTestApp(dataDir);
      const response = await app.request("/apple-health/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token-123",
        },
        body: JSON.stringify({ type: "wrong" }),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("validation failed");
    });
  });

  describe("POST /apple-health/sync", () => {
    it("returns 401 without auth", async () => {
      const { app } = createTestApp(dataDir);
      const response = await app.request("/apple-health/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeSyncPayload()),
      });
      expect(response.status).toBe(401);
    });

    it("stores valid sync payload and appends history", async () => {
      const { app } = createTestApp(dataDir);
      const response = await app.request("/apple-health/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token-123",
        },
        body: JSON.stringify(makeSyncPayload()),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { ok: boolean; stored: boolean };
      expect(body.ok).toBe(true);
      expect(body.stored).toBe(true);

      const latest = JSON.parse(fs.readFileSync(path.join(dataDir, "latest.json"), "utf-8"));
      expect(latest.type).toBe("health_sync");

      const history = fs.readFileSync(path.join(dataDir, "history.ndjson"), "utf-8");
      const lines = history.trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).type).toBe("health_sync");
    });

    it("returns 400 for invalid sync payload", async () => {
      const { app } = createTestApp(dataDir);
      const response = await app.request("/apple-health/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token-123",
        },
        body: JSON.stringify({ type: "health_sync", deviceId: "x" }),
      });
      expect(response.status).toBe(400);
    });
  });
});
