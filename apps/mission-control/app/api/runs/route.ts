import { NextResponse } from "next/server";
import { getRuns } from "@/lib/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor") || undefined;
  const agentId = searchParams.get("agentId") || undefined;
  const takeParam = Number(searchParams.get("take") || "20");
  const take = Number.isFinite(takeParam) ? takeParam : 20;

  const page = await getRuns({ cursor, agentId, take });
  return NextResponse.json(
    page,
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    }
  );
}
