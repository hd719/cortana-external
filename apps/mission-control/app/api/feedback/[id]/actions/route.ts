import { NextResponse } from "next/server";
import { addFeedbackAction } from "@/lib/feedback";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json()) as {
    actionType?: string;
    actionRef?: string | null;
    description?: string | null;
    status?: "planned" | "applied" | "verified" | "failed";
    verifiedAt?: string | null;
  };

  if (!body.actionType || !body.status) {
    return NextResponse.json({ error: "actionType and status are required" }, { status: 400 });
  }

  await addFeedbackAction(id, {
    actionType: body.actionType,
    actionRef: body.actionRef,
    description: body.description,
    status: body.status,
    verifiedAt: body.verifiedAt,
  });

  return NextResponse.json({ ok: true }, {
    status: 201,
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
