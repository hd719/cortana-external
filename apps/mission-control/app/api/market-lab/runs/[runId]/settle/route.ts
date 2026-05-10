import { NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/api-auth";
import { settleMarketLabRun } from "@/lib/market-lab";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const auth = requireSameOrigin(request);
  if (!auth.ok) return auth.response;

  const { runId } = await context.params;
  try {
    const data = await settleMarketLabRun(runId);
    return NextResponse.json({ status: "ok", data });
  } catch (error) {
    return NextResponse.json(
      { status: "error", error: error instanceof Error ? error.message : "Failed to settle Market Lab run" },
      { status: 500 },
    );
  }
}
