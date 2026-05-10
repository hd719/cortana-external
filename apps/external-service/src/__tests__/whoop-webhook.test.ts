import { describe, expect, it, vi } from "vitest";

import type { AppLogger } from "../lib/logger.js";
import { createWhoopWebhookRouter } from "../whoop/webhook-routes.js";
import { computeWhoopWebhookSignature, verifyWhoopWebhookSignature } from "../whoop/webhook-signature.js";
import type { WhoopWebhookEnqueueResult, WhoopWebhookEventRow, WhoopWebhookStore } from "../whoop/webhook-types.js";

const SECRET = "webhook-secret";
const NOW = new Date("2026-05-09T12:00:00.000Z");
const TIMESTAMP = String(NOW.getTime());

function eventRow(overrides?: Partial<WhoopWebhookEventRow>): WhoopWebhookEventRow {
  return {
    id: "event-id",
    traceId: "trace-1",
    whoopUserId: "user-1",
    eventType: "workout.updated",
    resourceId: "workout-1",
    status: "queued",
    receivedAt: NOW,
    processAfter: NOW,
    attemptCount: 0,
    lastError: null,
    payloadCompact: {},
    ...overrides,
  };
}

function fakeStore(result: WhoopWebhookEnqueueResult): WhoopWebhookStore {
  return {
    enqueueWebhookEvent: vi.fn(async () => result),
    claimDueEvents: vi.fn(async () => []),
    coalesceQueuedSiblings: vi.fn(async () => 0),
    recordAnalysis: vi.fn(async () => {}),
    markEventProcessed: vi.fn(async () => {}),
    markEventFailed: vi.fn(async () => {}),
    getOpsStatus: vi.fn(async () => ({
      queued: 0,
      processing: 0,
      failed: 0,
      sent: 0,
      noReply: 0,
      oldestQueuedAt: null,
      latestFailure: null,
      ingressAccepted24h: 0,
      ingressRejected24h: 0,
      latestRejectedIngressAt: null,
      latestRejectedIngressReason: null,
      recentIngressAttempts: [],
    })),
    recordIngressAttempt: vi.fn(async () => {}),
    trimRawPayloads: vi.fn(async () => {}),
  };
}

function captureLogger(messages: string[] = []): AppLogger {
  return {
    log: vi.fn((message: string) => messages.push(message)),
    printf: vi.fn(),
    error: vi.fn(),
  };
}

function signedRequest(body: Record<string, unknown>, signature = computeWhoopWebhookSignature(TIMESTAMP, JSON.stringify(body), SECRET)): Request {
  return new Request("http://localhost/webhooks/whoop", {
    method: "POST",
    headers: {
      "X-WHOOP-Signature": signature,
      "X-WHOOP-Signature-Timestamp": TIMESTAMP,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("WHOOP webhook signature", () => {
  it("validates the documented timestamp + raw body HMAC", () => {
    const rawBody = JSON.stringify({ trace_id: "trace-1" });
    const signature = computeWhoopWebhookSignature(TIMESTAMP, rawBody, SECRET);

    expect(verifyWhoopWebhookSignature({
      rawBody,
      signature,
      timestamp: TIMESTAMP,
      secret: SECRET,
      replayWindowSeconds: 300,
      now: NOW,
    })).toEqual({ ok: true });
  });

  it("rejects stale timestamps before payload processing", () => {
    const rawBody = JSON.stringify({ trace_id: "trace-1" });
    const oldTimestamp = String(new Date("2026-05-09T11:00:00.000Z").getTime());

    expect(verifyWhoopWebhookSignature({
      rawBody,
      signature: computeWhoopWebhookSignature(oldTimestamp, rawBody, SECRET),
      timestamp: oldTimestamp,
      secret: SECRET,
      replayWindowSeconds: 300,
      now: NOW,
    })).toEqual({ ok: false, reason: "stale_timestamp" });
  });
});

describe("WHOOP webhook route", () => {
  it("stores a valid signed event and triggers immediate processing when coalescing is disabled", async () => {
    const store = fakeStore({ status: "queued", event: eventRow() });
    const processor = { processDueEvents: vi.fn(async () => 1) };
    const logMessages: string[] = [];
    const app = createWhoopWebhookRouter({
      enabled: true,
      secret: SECRET,
      replayWindowSeconds: 300,
      bodyLimitBytes: 65_536,
      coalesceWindowMs: 0,
      store,
      processor,
      logger: captureLogger(logMessages),
      now: () => NOW,
    });
    const body = { user_id: "user-1", id: "workout-1", type: "workout.updated", trace_id: "trace-1" };

    const response = await app.request(signedRequest(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "queued", trace_id: "trace-1" });
    expect(store.enqueueWebhookEvent).toHaveBeenCalledWith(expect.objectContaining({
      payload: body,
      receivedAt: NOW,
      processAfter: NOW,
    }));
    expect(processor.processDueEvents).toHaveBeenCalledTimes(1);
    expect(logMessages).toEqual([
      expect.stringContaining('"status":"accepted"'),
    ]);
    expect(store.recordIngressAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "accepted",
      reason: "queued",
      traceId: "trace-1",
      resourceId: "workout-1",
      signaturePresent: true,
      timestampPresent: true,
    }));
  });

  it("rejects invalid signatures without enqueueing", async () => {
    const store = fakeStore({ status: "queued", event: eventRow() });
    const logMessages: string[] = [];
    const app = createWhoopWebhookRouter({
      enabled: true,
      secret: SECRET,
      replayWindowSeconds: 300,
      bodyLimitBytes: 65_536,
      coalesceWindowMs: 0,
      store,
      logger: captureLogger(logMessages),
      now: () => NOW,
    });

    const response = await app.request(signedRequest(
      { user_id: "user-1", id: "workout-1", type: "workout.updated", trace_id: "trace-1" },
      "bad-signature",
    ));

    expect(response.status).toBe(401);
    expect(store.enqueueWebhookEvent).not.toHaveBeenCalled();
    expect(logMessages).toEqual([
      expect.stringContaining('"status":"rejected"'),
    ]);
    expect(logMessages[0]).toContain('"reason":"invalid_signature"');
    expect(store.recordIngressAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: "rejected",
      reason: "invalid_signature",
      traceId: "trace-1",
      resourceId: "workout-1",
      signaturePresent: true,
      timestampPresent: true,
    }));
  });
});
