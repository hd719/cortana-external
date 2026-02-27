import { NextResponse } from "next/server";
import { addCouncilMembers, getCouncilSessionById } from "@/lib/council";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const body = (await request.json()) as {
    members?: Array<{ agentId?: string; role?: string | null; weight?: number; stance?: string | null }>;
  };

  if (!Array.isArray(body.members) || body.members.length === 0) {
    return NextResponse.json({ error: "Invalid members payload" }, { status: 400 });
  }

  const normalized = body.members
    .filter((member) => typeof member.agentId === "string" && member.agentId.trim().length > 0)
    .map((member) => ({
      agentId: member.agentId!.trim(),
      role: member.role ?? null,
      weight: typeof member.weight === "number" ? member.weight : 1,
      stance: member.stance ?? null,
    }));

  if (normalized.length === 0) {
    return NextResponse.json({ error: "No valid members provided" }, { status: 400 });
  }

  await addCouncilMembers(id, normalized);
  const session = await getCouncilSessionById(id);

  return NextResponse.json({ ok: true, session }, {
    status: 201,
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
