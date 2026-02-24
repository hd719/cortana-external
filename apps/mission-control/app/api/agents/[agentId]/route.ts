import { NextResponse } from "next/server";
import { getAgentDetail } from "@/lib/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const detail = await getAgentDetail(agentId);

  if (!detail) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json(detail);
}
