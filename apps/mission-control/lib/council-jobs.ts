import { appendCouncilMessage, getCouncilSessionById } from "@/lib/council";

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

  const pending = (session.members ?? []).filter((member) => !member.vote);
  if (pending.length === 0) {
    return { sessionId, dispatched: 0, skipped: true, reason: "no_pending_members" };
  }

  const nextTurn = Math.max(0, ...(session.messages ?? []).map((m) => m.turnNo)) + 1;

  await Promise.all(
    pending.map((member, index) =>
      appendCouncilMessage({
        sessionId,
        turnNo: nextTurn + index,
        speakerId: member.agentId,
        messageType: "fanout_dispatch",
        content: `Queued deliberation request for ${member.agentId}`,
        metadata: {
          role: member.role,
          weight: member.weight,
        },
      }),
    ),
  );

  return { sessionId, dispatched: pending.length, skipped: false };
}
