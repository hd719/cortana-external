import { NextResponse } from "next/server";
import { getFeedbackMetrics } from "@/lib/feedback";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const metrics = await getFeedbackMetrics();
  return NextResponse.json(metrics, {
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
