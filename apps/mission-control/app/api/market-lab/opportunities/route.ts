import { NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/api-auth";
import { generateMarketLabOpportunities } from "@/lib/market-lab";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  const auth = requireSameOrigin(request);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json().catch(() => ({}))) as { watchlist?: string; symbols?: string[] };
    const data = await generateMarketLabOpportunities({
      watchlist: body.watchlist,
      symbols: Array.isArray(body.symbols) ? body.symbols : undefined,
    });
    return NextResponse.json({ status: "ok", data });
  } catch (error) {
    return NextResponse.json(
      { status: "error", error: error instanceof Error ? error.message : "Failed to generate opportunity board" },
      { status: 500 },
    );
  }
}
