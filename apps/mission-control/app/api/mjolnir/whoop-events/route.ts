import { NextResponse } from "next/server";

import { loadWhoopLiveEvents } from "@/lib/whoop-live-events";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  const source = url.searchParams.get("source");
  const status = url.searchParams.get("status");

  return NextResponse.json(
    await loadWhoopLiveEvents({
      limit: Number.isFinite(limit) ? limit : 20,
      source,
      status,
    }),
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    },
  );
}
