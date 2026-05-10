import { NextResponse } from "next/server";
import { getMarketLabEvents } from "@/lib/market-lab";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await context.params;
  try {
    const data = await getMarketLabEvents(runId);
    return NextResponse.json({ status: "ok", data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { status: "error", error: error instanceof Error ? error.message : "Failed to load Market Lab events" },
      { status: 404 },
    );
  }
}
