import { NextResponse } from "next/server";
import { getApprovalById, updateApprovalStatus } from "@/lib/approvals";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const approval = await getApprovalById(id);

  if (!approval) {
    return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  }

  return NextResponse.json(approval, {
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
    action?: "approve" | "reject" | "approve_edited";
    decision?: Record<string, unknown>;
    actor?: string;
  };

  if (!body.action || !["approve", "reject", "approve_edited"].includes(body.action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const existingApproval = await getApprovalById(id);

  if (!existingApproval) {
    return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  }

  if (existingApproval.status !== "pending") {
    return NextResponse.json(
      { error: "Approval already resolved", status: existingApproval.status },
      { status: 409 },
    );
  }

  await updateApprovalStatus(id, body.action, body.decision, body.actor);
  const approval = await getApprovalById(id);

  return NextResponse.json({ ok: true, approval }, {
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
