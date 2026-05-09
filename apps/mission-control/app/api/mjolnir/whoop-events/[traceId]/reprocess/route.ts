import { NextResponse } from "next/server";

import { requeueWhoopWebhookEvent } from "@/lib/whoop-live-events";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type ReprocessBody = {
  confirm?: unknown;
  reason?: unknown;
};

function errorStatus(error: unknown): number {
  const statusCode = typeof error === "object" && error && "statusCode" in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : NaN;
  return Number.isFinite(statusCode) ? statusCode : 500;
}

export async function POST(
  request: Request,
  context: { params: Promise<unknown> },
) {
  const params = await context.params;
  const traceId = params && typeof params === "object" && "traceId" in params
    ? String((params as { traceId?: unknown }).traceId ?? "")
    : "";
  if (!traceId) {
    return NextResponse.json({ error: "Missing trace id" }, { status: 400 });
  }
  let body: ReprocessBody;

  try {
    body = await request.json() as ReprocessBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.confirm !== true) {
    return NextResponse.json({ error: "Reprocess requires explicit confirmation" }, { status: 400 });
  }

  try {
    const reason = typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : "operator requested replay";
    return NextResponse.json(await requeueWhoopWebhookEvent(traceId, reason), { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reprocess WHOOP event";
    return NextResponse.json({ error: message }, { status: errorStatus(error) });
  }
}
