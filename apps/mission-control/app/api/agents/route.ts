import { NextResponse } from "next/server";
import { getAgents } from "@/lib/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const agents = await getAgents();
  return NextResponse.json(
    { agents },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    }
  );
}
