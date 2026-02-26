import { NextResponse } from "next/server";
import { reconcileStaleRuns } from "@/lib/run-reconciliation";

export const dynamic = "force-dynamic";

export async function POST() {
  const reconciled = await reconcileStaleRuns();
  return NextResponse.json(
    { reconciled },
    { headers: { "cache-control": "no-store" } },
  );
}
