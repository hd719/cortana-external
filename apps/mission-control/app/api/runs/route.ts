import { NextResponse } from "next/server";
import { getRuns } from "@/lib/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const runs = await getRuns();
  return NextResponse.json(
    { runs },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    }
  );
}
