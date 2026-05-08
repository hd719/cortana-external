import { NextResponse } from "next/server";

import {
  archiveCodexWorkspaceSession,
  codexRunErrorStatus,
  deleteCodexWorkspaceSession,
  getCodexSessionPage,
  renameCodexWorkspaceSession,
} from "@/lib/codex-session-workspace";
import { CodexRunError } from "@/lib/codex-runs";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  const { searchParams } = new URL(request.url);

  try {
    return NextResponse.json(await getCodexSessionPage(sessionId, searchParams));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load Codex session";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

type MutateSessionBody = {
  action?: string;
  threadName?: unknown;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;

  try {
    const body = (await request.json()) as MutateSessionBody;
    if (body.action === "archive") {
      return NextResponse.json(await archiveCodexWorkspaceSession(sessionId));
    }

    if (body.action === "rename") {
      return NextResponse.json(await renameCodexWorkspaceSession(sessionId, body.threadName));
    }

    return NextResponse.json({ error: "Unsupported session action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update Codex session";
    const status = error instanceof CodexRunError
      ? codexRunErrorStatus(error)
      : message.includes("not found")
        ? 404
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;

  try {
    return NextResponse.json(await deleteCodexWorkspaceSession(sessionId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete Codex session";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
