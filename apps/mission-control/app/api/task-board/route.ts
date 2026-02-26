import { NextRequest, NextResponse } from "next/server";
import { getTaskBoard } from "@/lib/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const completedLimitRaw = request.nextUrl.searchParams.get("completedLimit");
  const completedOffsetRaw = request.nextUrl.searchParams.get("completedOffset");

  const completedLimit = completedLimitRaw ? Number.parseInt(completedLimitRaw, 10) : undefined;
  const completedOffset = completedOffsetRaw ? Number.parseInt(completedOffsetRaw, 10) : undefined;

  const data = await getTaskBoard({
    completedLimit: Number.isFinite(completedLimit) ? completedLimit : undefined,
    completedOffset: Number.isFinite(completedOffset) ? completedOffset : undefined,
  });

  return NextResponse.json(data, {
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
