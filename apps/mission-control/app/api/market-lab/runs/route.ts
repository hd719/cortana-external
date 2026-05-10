import { NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/api-auth";
import { isValidMarketLabSymbol, listMarketLabRuns, startMarketLabRun } from "@/lib/market-lab";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const parseLimit = (value: string | null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 50;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const data = await listMarketLabRuns(parseLimit(searchParams.get("limit")));
    return NextResponse.json({ status: "ok", data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { status: "error", error: error instanceof Error ? error.message : "Failed to list Market Lab runs" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = requireSameOrigin(request);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as { symbol?: string };
    const symbol = body.symbol?.trim().toUpperCase() ?? "";
    if (!isValidMarketLabSymbol(symbol)) {
      return NextResponse.json({ status: "error", error: "Invalid symbol" }, { status: 400 });
    }
    const data = await startMarketLabRun(symbol);
    return NextResponse.json({ status: "ok", data }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { status: "error", error: error instanceof Error ? error.message : "Failed to start Market Lab run" },
      { status: 500 },
    );
  }
}
