import { NextResponse } from "next/server";

import { requireSameOrigin } from "@/lib/api-auth";
import { CodexRunError } from "@/lib/codex-runs";
import { codexRunErrorStatus, createCodexSessionRun } from "@/lib/codex-session-workspace";
import { getMarketLabCodexPacket } from "@/lib/market-lab";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const auth = requireSameOrigin(request);
  if (!auth.ok) return auth.response;

  const { runId } = await context.params;

  try {
    const packet = await getMarketLabCodexPacket(runId);
    const result = await createCodexSessionRun({
      prompt: packet.prompt,
      workspaceKey: "cortana-external",
    });

    return NextResponse.json({ status: "ok", data: { ...result, packet_path: packet.packet_path } }, { status: 202 });
  } catch (error) {
    if (error instanceof CodexRunError) {
      return NextResponse.json({ status: "error", error: error.message }, { status: codexRunErrorStatus(error) });
    }

    const message = error instanceof Error ? error.message : "Failed to start Codex review";
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}
