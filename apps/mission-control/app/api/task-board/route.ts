import { NextResponse } from "next/server";
import { getTaskBoard } from "@/lib/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const data = await getTaskBoard();
  return NextResponse.json(data, {
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
