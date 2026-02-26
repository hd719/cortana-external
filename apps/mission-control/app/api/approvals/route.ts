import { NextResponse } from "next/server";
import { ApprovalFilters, getApprovals } from "@/lib/approvals";

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
