import { NextResponse } from "next/server";
import { getDecisionTraces } from "@/lib/decision-traces";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const parseNumber = (value: string | null) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const data = await getDecisionTraces({
    rangeHours: parseNumber(searchParams.get("rangeHours")) ?? 48,
    actionType: searchParams.get("actionType") || undefined,
    triggerType: searchParams.get("triggerType") || undefined,
    outcome: (searchParams.get("outcome") as "success" | "fail" | "unknown" | "all" | null) ?? "all",
    confidenceMin: parseNumber(searchParams.get("confidenceMin")),
    confidenceMax: parseNumber(searchParams.get("confidenceMax")),
    limit: parseNumber(searchParams.get("limit")) ?? 120,
  });

  return NextResponse.json(data, {
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
