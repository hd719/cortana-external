import { NextResponse } from "next/server";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { requireSameOrigin } from "@/lib/api-auth";
import { CodexRunError, getCodexRun } from "@/lib/codex-runs";
import { codexRunErrorStatus, createCodexSessionRun } from "@/lib/codex-session-workspace";
import { getMarketLabCodexPacket, getMarketLabRun, resolveMarketLabEnvironment } from "@/lib/market-lab";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type CodexReviewStartResult =
  | {
      status: "running";
      streamId: string;
      packet_path: string;
      sessionId?: string | null;
      reused?: boolean;
    }
  | {
      status: "already_requested";
      streamId: string;
      packet_path: string;
      sessionId?: string | null;
      reused?: boolean;
    }
  | {
      status: "already_attached";
      packet_path: string | null;
      codex_review: unknown;
    }
  | {
      status: "not_requested";
      packet_path: string | null;
    };

type CodexReviewRequestMarker = {
  schema_version: "market-lab-codex-request/v1";
  environment: string;
  run_id: string;
  stream_id: string;
  session_id?: string | null;
  packet_path: string;
  status: "running";
  created_at: string;
  updated_at: string;
};

const activeCodexReviews = new Map<string, { streamId: string; packetPath: string }>();
const pendingCodexReviewStarts = new Map<string, Promise<CodexReviewStartResult>>();

function codexReviewKey(runId: string) {
  return `${resolveMarketLabEnvironment()}:${runId}`;
}

function markerPathForPacket(packetPath: string | null | undefined) {
  if (!packetPath) return null;
  return path.join(path.dirname(packetPath), "codex-review-request.json");
}

async function readCodexReviewMarker(packetPath: string | null | undefined) {
  const markerPath = markerPathForPacket(packetPath);
  if (!markerPath) return null;

  try {
    const raw = await readFile(markerPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<CodexReviewRequestMarker>;
    if (
      parsed.schema_version === "market-lab-codex-request/v1" &&
      typeof parsed.stream_id === "string" &&
      typeof parsed.packet_path === "string"
    ) {
      return parsed as CodexReviewRequestMarker;
    }
  } catch {
    return null;
  }

  return null;
}

async function writeCodexReviewMarker(runId: string, streamId: string, packetPath: string) {
  const markerPath = markerPathForPacket(packetPath);
  if (!markerPath) return;

  const now = new Date().toISOString();
  const marker: CodexReviewRequestMarker = {
    schema_version: "market-lab-codex-request/v1",
    environment: resolveMarketLabEnvironment(),
    run_id: runId,
    stream_id: streamId,
    session_id: null,
    packet_path: packetPath,
    status: "running",
    created_at: now,
    updated_at: now,
  };
  await mkdir(path.dirname(markerPath), { recursive: true });
  const tmpPath = `${markerPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  await rename(tmpPath, markerPath);
}

function getActiveCodexReview(key: string): CodexReviewStartResult | null {
  const activeReview = activeCodexReviews.get(key);
  if (!activeReview) return null;

  const activeRun = getCodexRun(activeReview.streamId);
  if (activeRun?.status === "running") {
    return {
      status: "running",
      streamId: activeReview.streamId,
      packet_path: activeReview.packetPath,
      sessionId: activeRun.sessionId,
      reused: true,
    };
  }

  activeCodexReviews.delete(key);
  return null;
}

async function getPersistedCodexReviewRequest(packetPath: string | null | undefined) {
  const marker = await readCodexReviewMarker(packetPath);
  if (!marker) return null;

  const markerRun = getCodexRun(marker.stream_id);
  if (markerRun?.status === "running") {
    return {
      status: "running",
      streamId: marker.stream_id,
      packet_path: marker.packet_path,
      sessionId: markerRun.sessionId ?? marker.session_id ?? null,
      reused: true,
    } satisfies CodexReviewStartResult;
  }

  return {
    status: "already_requested",
    streamId: marker.stream_id,
    packet_path: marker.packet_path,
    sessionId: markerRun?.sessionId ?? marker.session_id ?? null,
    reused: true,
  } satisfies CodexReviewStartResult;
}

async function getCodexReviewState(runId: string): Promise<CodexReviewStartResult> {
  const existing = await getMarketLabRun(runId);
  const attached = existing.review?.codex_review?.status === "attached" ? existing.review.codex_review : null;
  const existingPacketPath = existing.review?.artifact_paths?.codex_packet ?? null;
  if (attached) {
    return {
      status: "already_attached",
      packet_path: existingPacketPath,
      codex_review: attached,
    };
  }

  const active = getActiveCodexReview(codexReviewKey(runId));
  if (active) return active;

  const persisted = await getPersistedCodexReviewRequest(existingPacketPath);
  if (persisted) return persisted;

  return {
    status: "not_requested",
    packet_path: existingPacketPath,
  };
}

async function startOrReuseCodexReview(runId: string): Promise<CodexReviewStartResult> {
  const key = codexReviewKey(runId);
  const pending = pendingCodexReviewStarts.get(key);
  if (pending) {
    const result = await pending;
    return result.status === "running" ? { ...result, reused: true } : result;
  }

  const startPromise = (async () => {
    const existingState = await getCodexReviewState(runId);
    if (existingState.status !== "not_requested") return existingState;

    const packet = await getMarketLabCodexPacket(runId);
    const activeAfterPacket = getActiveCodexReview(key);
    if (activeAfterPacket) return activeAfterPacket;

    const persistedAfterPacket = await getPersistedCodexReviewRequest(packet.packet_path);
    if (persistedAfterPacket) return persistedAfterPacket;

    const result = await createCodexSessionRun({
      prompt: packet.prompt,
      workspaceKey: "cortana-external",
    });
    activeCodexReviews.set(key, { streamId: result.streamId, packetPath: packet.packet_path });
    await writeCodexReviewMarker(runId, result.streamId, packet.packet_path).catch(() => undefined);
    return {
      status: "running",
      streamId: result.streamId,
      packet_path: packet.packet_path,
    } satisfies CodexReviewStartResult;
  })();

  pendingCodexReviewStarts.set(key, startPromise);
  try {
    return await startPromise;
  } finally {
    pendingCodexReviewStarts.delete(key);
  }
}

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const auth = requireSameOrigin(request);
  if (!auth.ok) return auth.response;

  const { runId } = await context.params;

  try {
    const result = await startOrReuseCodexReview(runId);
    const status = result.status === "already_attached" ? 200 : 202;

    return NextResponse.json({ status: "ok", data: result }, { status });
  } catch (error) {
    if (error instanceof CodexRunError) {
      return NextResponse.json({ status: "error", error: error.message }, { status: codexRunErrorStatus(error) });
    }

    const message = error instanceof Error ? error.message : "Failed to start Codex review";
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const auth = requireSameOrigin(request);
  if (!auth.ok) return auth.response;

  const { runId } = await context.params;

  try {
    const result = await getCodexReviewState(runId);
    return NextResponse.json({ status: "ok", data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read Codex review state";
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}
