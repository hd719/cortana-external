import { NextResponse } from "next/server";
import { getFeedbackById, updateFeedbackStatus } from "@/lib/feedback";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const item = await getFeedbackById(id);

  if (!item) {
    return NextResponse.json({ error: "Feedback item not found" }, { status: 404 });
  }

  return NextResponse.json(item, {
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json()) as {
    status?: "new" | "triaged" | "in_progress" | "verified" | "wont_fix";
    owner?: string;
  };

  if (!body.status) {
    return NextResponse.json({ error: "status is required" }, { status: 400 });
  }

  await updateFeedbackStatus(id, body.status, body.owner);
  const item = await getFeedbackById(id);

  return NextResponse.json({ ok: true, item }, {
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
