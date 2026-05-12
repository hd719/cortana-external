import { NextResponse } from "next/server";
import { isValidArtifactKind, readMarketLabArtifact } from "@/lib/market-lab";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string; kind: string }> },
) {
  const { runId, kind } = await context.params;
  if (!isValidArtifactKind(kind)) {
    return NextResponse.json(
      { status: "error", error: `Unknown artifact kind: ${kind}` },
      { status: 400 },
    );
  }

  try {
    const data = await readMarketLabArtifact(runId, kind);
    return NextResponse.json(
      { status: "ok", data },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { status: "error", error: error instanceof Error ? error.message : "Failed to read Market Lab artifact" },
      { status: 404 },
    );
  }
}
