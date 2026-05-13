import { NextResponse } from "next/server";
import { getMarketLabPortfolio } from "@/lib/market-lab";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const data = await getMarketLabPortfolio();
    return NextResponse.json({ status: "ok", data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { status: "error", error: error instanceof Error ? error.message : "Failed to load portfolio context" },
      { status: 500 },
    );
  }
}
