import crypto from "node:crypto";

export interface WhoopSignatureInput {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  secret: string;
  replayWindowSeconds: number;
  now?: Date;
}

export type WhoopSignatureResult =
  | { ok: true }
  | { ok: false; reason: "missing_header" | "missing_secret" | "stale_timestamp" | "invalid_timestamp" | "invalid_signature" };

function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function computeWhoopWebhookSignature(timestamp: string, rawBody: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(timestamp)
    .update(rawBody)
    .digest("base64");
}

export function verifyWhoopWebhookSignature(input: WhoopSignatureInput): WhoopSignatureResult {
  if (!input.secret.trim()) {
    return { ok: false, reason: "missing_secret" };
  }
  if (!input.signature || !input.timestamp) {
    return { ok: false, reason: "missing_header" };
  }

  const timestampMs = Number(input.timestamp) * 1000;
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, reason: "invalid_timestamp" };
  }

  const nowMs = input.now?.getTime() ?? Date.now();
  const ageSeconds = Math.abs(nowMs - timestampMs) / 1000;
  if (ageSeconds > input.replayWindowSeconds) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const expected = computeWhoopWebhookSignature(input.timestamp, input.rawBody, input.secret);
  if (!timingSafeEqualString(expected, input.signature)) {
    return { ok: false, reason: "invalid_signature" };
  }

  return { ok: true };
}
