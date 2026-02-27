import { NextResponse } from "next/server";
import { createFeedback, FeedbackFilters, getFeedbackItems } from "@/lib/feedback";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const parseNumber = (value: string | null) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const filters: FeedbackFilters = {
    status: (searchParams.get("status") as FeedbackFilters["status"]) ?? "all",
    remediationStatus: (searchParams.get("remediationStatus") as FeedbackFilters["remediationStatus"]) ?? "all",
    severity: (searchParams.get("severity") as FeedbackFilters["severity"]) ?? "all",
    category: searchParams.get("category") || undefined,
    source: (searchParams.get("source") as FeedbackFilters["source"]) ?? "all",
    rangeHours: parseNumber(searchParams.get("rangeHours")) ?? 24 * 14,
    limit: parseNumber(searchParams.get("limit")) ?? 120,
  };

  const items = await getFeedbackItems(filters);

  return NextResponse.json({ items }, {
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    runId?: string | null;
    taskId?: string | null;
    agentId?: string | null;
    source: "user" | "system" | "evaluator";
    category: string;
    severity: "low" | "medium" | "high" | "critical";
    summary: string;
    details?: Record<string, unknown>;
    recurrenceKey?: string | null;
    status?: "new" | "triaged" | "in_progress" | "verified" | "wont_fix";
    owner?: string | null;
  };

  const id = await createFeedback(body);
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
