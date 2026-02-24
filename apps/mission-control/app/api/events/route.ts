import { NextResponse } from "next/server";
import { getEvents } from "@/lib/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const events = await getEvents();
  return NextResponse.json(
    { events },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    }
  );
}
