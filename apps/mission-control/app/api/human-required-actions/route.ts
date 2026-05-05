import { NextResponse } from "next/server";
import { listHumanRequiredActions } from "@/lib/human-required-actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    return NextResponse.json({ ok: true, items: listHumanRequiredActions() });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "failed to load human-required actions",
      items: [],
    }, { status: 503 });
  }
}
