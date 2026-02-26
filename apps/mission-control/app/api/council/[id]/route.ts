import { NextResponse } from "next/server";
import { finalizeDecision, getCouncilSessionById, submitVote } from "@/lib/council";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const session = await getCouncilSessionById(id);

  if (!session) {
    return NextResponse.json({ error: "Council session not found" }, { status: 404 });
  }

  return NextResponse.json(session, {
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json()) as
    | {
      action?: "finalize";
      decision?: Record<string, unknown>;
      confidence?: number;
      rationale?: string;
    }
    | {
      action?: "vote";
      memberId?: number;
      vote?: string;
      reasoning?: string;
      voteScore?: number;
    };

  if (body.action === "finalize") {
    if (!("decision" in body) || !("confidence" in body) || !("rationale" in body) || !body.decision || typeof body.confidence !== "number" || typeof body.rationale !== "string") {
      return NextResponse.json({ error: "Invalid finalize payload" }, { status: 400 });
    }

    await finalizeDecision(id, body.decision, body.confidence, body.rationale);
  } else if (body.action === "vote") {
    if (!("memberId" in body) || !("vote" in body) || !("reasoning" in body) || typeof body.memberId !== "number" || typeof body.vote !== "string" || typeof body.reasoning !== "string") {
      return NextResponse.json({ error: "Invalid vote payload" }, { status: 400 });
    }

    await submitVote(id, body.memberId, body.vote, body.reasoning, body.voteScore);
  } else {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const session = await getCouncilSessionById(id);

  return NextResponse.json({ ok: true, session }, {
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
