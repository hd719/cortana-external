import { NextResponse } from "next/server";
import { refreshAutonomyOpsArtifact, getAutonomyOpsSnapshot } from "@/lib/autonomy-ops";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST() {
  try {
    const snapshot = await refreshAutonomyOpsArtifact();
    return NextResponse.json({ ...snapshot, refreshedAt: new Date().toISOString() }, {
      headers: { "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate" },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      stale: true,
      error: error instanceof Error ? error.message : "refresh failed",
      staleData: getAutonomyOpsSnapshot(),
    }, { status: 500 });
  }
}
