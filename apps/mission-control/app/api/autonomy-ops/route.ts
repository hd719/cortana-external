import { NextResponse } from "next/server";
import { getAutonomyOpsSnapshot } from "@/lib/autonomy-ops";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const snapshot = getAutonomyOpsSnapshot();
  return NextResponse.json(snapshot, {
    status: snapshot.ok ? 200 : 503,
    headers: { "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate" },
  });
}
