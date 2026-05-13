import { NextResponse } from "next/server";
import { getMarketLabOpportunityBoard } from "@/lib/market-lab";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request: Request, context: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await context.params;
  try {
    const data = await getMarketLabOpportunityBoard(boardId);
    return NextResponse.json({ status: "ok", data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { status: "error", error: error instanceof Error ? error.message : "Failed to load opportunity board" },
      { status: 404 },
    );
  }
}
