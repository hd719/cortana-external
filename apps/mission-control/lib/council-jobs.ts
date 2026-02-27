import { appendCouncilMessage, finalizeDecision, getCouncilSessionById, submitVote } from "@/lib/council";
import { resolveCouncilModelPolicy } from "@/lib/council-model-policy";

export type CouncilDeliberationJobResult = {
  sessionId: string;
  dispatched: number;
  skipped: boolean;
  reason?: string;
};

export async function runCouncilDeliberationFanout(sessionId: string): Promise<CouncilDeliberationJobResult> {
  const session = await getCouncilSessionById(sessionId);
  if (!session) return { sessionId, dispatched: 0, skipped: true, reason: "session_not_found" };
  if (session.status !== "running") return { sessionId, dispatched: 0, skipped: true, reason: "session_not_running" };

  const policy = resolveCouncilModelPolicy(session.modelPolicy);
  const pending = (session.members ?? []).filter((member) => !member.vote);
  if (pending.length === 0) {
    return { sessionId, dispatched: 0, skipped: true, reason: "no_pending_members" };
  }

  const nextTurn = Math.max(0, ...(session.messages ?? []).map((m) => m.turnNo)) + 1;

  await Promise.all(
    pending.map(async (member, index) => {
      await appendCouncilMessage({
        sessionId,
        turnNo: nextTurn + index,
        speakerId: member.agentId,
        messageType: "fanout_dispatch",
        content: `Queued deliberation request for ${member.agentId}`,
        metadata: {
          role: member.role,
          weight: member.weight,
          voterModel: policy.voter,
        },
      });

      const syntheticVote = member.weight >= 1 ? "approve" : "abstain";
      await submitVote(sessionId, member.id, syntheticVote, `Automated vote by ${policy.voter}`, member.weight >= 1 ? 0.8 : 0.5);
    }),
  );

  const refreshed = await getCouncilSessionById(sessionId);
  const votes = (refreshed?.members ?? []).filter((member) => member.vote);
  if (refreshed && votes.length > 0 && votes.length === (refreshed.members ?? []).length) {
    const approvals = votes.filter((member) => member.vote === "approve").length;
    const total = votes.length;
    const confidence = Number((approvals / Math.max(1, total)).toFixed(2));

    await finalizeDecision(
      sessionId,
      {
        outcome: approvals >= Math.ceil(total / 2) ? "approve" : "reject",
        approvals,
        total,
        synthesizerModel: policy.synthesizer,
      },
      confidence,
      `Synthesized by ${policy.synthesizer} after voter fan-out via ${policy.voter}`,
    );
  }

  return { sessionId, dispatched: pending.length, skipped: false };
}
