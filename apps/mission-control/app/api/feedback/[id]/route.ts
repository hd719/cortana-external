import { NextResponse } from "next/server";
import { getFeedbackById, REMEDIATION_STATUSES, updateFeedbackRemediation, type RemediationStatus } from "@/lib/feedback";

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
    remediationStatus?: string;
    remediationNotes?: string | null;
    resolvedBy?: string | null;
  };

  if (!body.remediationStatus) {
    return NextResponse.json({ error: "remediationStatus is required" }, { status: 400 });
  }

  if (!REMEDIATION_STATUSES.includes(body.remediationStatus as RemediationStatus)) {
    return NextResponse.json({ error: "Invalid remediationStatus" }, { status: 400 });
  }

  const updated = await updateFeedbackRemediation(
    id,
    body.remediationStatus as RemediationStatus,
    body.remediationNotes,
    body.resolvedBy,
  );

  if (!updated) {
    return NextResponse.json({ error: "Feedback item not found" }, { status: 404 });
  }

  const item = await getFeedbackById(id);

  return NextResponse.json({ ok: true, item }, {
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
