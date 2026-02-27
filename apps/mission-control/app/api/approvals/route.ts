import { NextResponse } from "next/server";
import { ApprovalFilters, createApproval, getApprovals } from "@/lib/approvals";
import { sendApprovalTelegramNotification } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const parseNumber = (value: string | null) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const filters: ApprovalFilters = {
    status: (searchParams.get("status") as ApprovalFilters["status"]) ?? "all",
    risk_level: (searchParams.get("risk_level") as ApprovalFilters["risk_level"]) ?? undefined,
    rangeHours: parseNumber(searchParams.get("rangeHours")) ?? 168,
    limit: parseNumber(searchParams.get("limit")) ?? 120,
  };

  const approvals = await getApprovals(filters);

  return NextResponse.json({ approvals }, {
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    agent_id?: string;
    action_type?: string;
    proposal?: Record<string, unknown>;
    rationale?: string;
    risk_level?: "p0" | "p1" | "p2" | "p3";
    blast_radius?: string;
    resume_payload?: Record<string, unknown>;
    run_id?: string;
    task_id?: string;
  };

  if (!body.agent_id || !body.action_type || !body.proposal || !body.risk_level) {
    return NextResponse.json(
      { error: "Missing required fields: agent_id, action_type, proposal, risk_level" },
      { status: 400 },
    );
  }

  if (!["p0", "p1", "p2", "p3"].includes(body.risk_level)) {
    return NextResponse.json({ error: "Invalid risk_level" }, { status: 400 });
  }

  const approval = await createApproval({
    agentId: body.agent_id,
    actionType: body.action_type,
    proposal: body.proposal,
    rationale: body.rationale ?? null,
    riskLevel: body.risk_level,
    blastRadius: body.blast_radius ?? null,
    resumePayload: body.resume_payload ?? null,
    runId: body.run_id ?? null,
    taskId: body.task_id ?? null,
  });

  const shouldNotify = Boolean(
    approval && (
      approval.riskLevel === "p0" ||
      approval.riskLevel === "p1" ||
      (approval.riskLevel === "p2" && !approval.autoApprovable)
    ),
  );

  if (approval && shouldNotify) {
    void sendApprovalTelegramNotification({
      approvalId: approval.id,
      riskLevel: approval.riskLevel,
      actionType: approval.actionType,
      agentId: approval.agentId,
      rationale: approval.rationale,
    }).catch((error) => {
      console.error("[approvals] Failed to send Telegram notification", error);
    });
  }

  return NextResponse.json({ approval }, {
    status: 201,
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
