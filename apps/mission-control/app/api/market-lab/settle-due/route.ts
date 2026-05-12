import { NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/api-auth";
import { settleDueMarketLabRuns } from "@/lib/market-lab";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  const auth = requireSameOrigin(request);
  if (!auth.ok) return auth.response;

  try {
    const data = await settleDueMarketLabRuns();
    return NextResponse.json({ status: "ok", data });
  } catch (error) {
    return NextResponse.json(
      { status: "error", error: error instanceof Error ? error.message : "Failed to settle due Market Lab windows" },
      { status: 500 },
    );
  }
}
