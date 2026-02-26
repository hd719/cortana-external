import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTaskPrisma } from "@/lib/task-prisma";
import prisma from "@/lib/prisma";
import {
  createCouncilSession,
  finalizeDecision,
  getCouncilSessionById,
  getCouncilSessions,
  submitVote,
} from "@/lib/council";

vi.mock("@/lib/task-prisma", () => ({
  getTaskPrisma: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
  },
}));

describe("lib/council", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTaskPrisma).mockReturnValue(undefined);
  });

  it("getCouncilSessions returns filtered list", async () => {
    const createdAt = new Date("2026-02-26T12:00:00.000Z");
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([
      {
        id: "c-1",
        task_id: "t-1",
        topic: "Deploy",
        objective: "Ship",
        mode: "majority",
        status: "running",
        created_by: "hamel",
        created_at: createdAt,
        decided_at: null,
        final_decision: null,
        confidence: null,
        rationale: null,
      },
    ]);

    const result = await getCouncilSessions({ status: "running", mode: "majority", rangeHours: 24, limit: 10 });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "c-1", topic: "Deploy", mode: "majority", status: "running" });
    const query = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0][0] as string;
    expect(query).toContain("status = 'running'");
    expect(query).toContain("mode = 'majority'");
    expect(query).toContain("INTERVAL '24 hours'");
    expect(query).toContain("LIMIT 10");
  });

  it("getCouncilSessionById returns session with members and messages", async () => {
    const createdAt = new Date("2026-02-26T12:00:00.000Z");
    vi.mocked(prisma.$queryRawUnsafe)
      .mockResolvedValueOnce([
        {
          id: "c-1",
          task_id: null,
          topic: "Deploy",
          objective: "Ship",
          mode: "weighted",
          status: "decided",
          created_by: "system",
          created_at: createdAt,
          decided_at: createdAt,
          final_decision: { outcome: "yes" },
          confidence: 0.92,
          rationale: "Strong signal",
          member_id: 1,
          session_id: "c-1",
          agent_id: "agent-a",
          role: "reviewer",
          weight: 2,
          stance: null,
          vote: "approve",
          vote_score: 0.9,
          reasoning: "good",
          responded_at: createdAt,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 11,
          session_id: "c-1",
          turn_no: 1,
          speaker_id: "agent-a",
          message_type: "proposal",
          content: "Let us ship",
          metadata: null,
          created_at: createdAt,
        },
      ]);

    const result = await getCouncilSessionById("c-1");

    expect(result?.id).toBe("c-1");
    expect(result?.members).toHaveLength(1);
    expect(result?.messages).toHaveLength(1);
    expect(result?.members?.[0].agentId).toBe("agent-a");
    expect(result?.messages?.[0].messageType).toBe("proposal");
  });

  it("createCouncilSession inserts correctly", async () => {
    const createdAt = new Date("2026-02-26T12:00:00.000Z");
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([
      {
        id: "c-2",
        task_id: "task-2",
        topic: "Patch rollout",
        objective: "Reduce risk",
        mode: "majority",
        status: "running",
        created_by: "mission-control",
        created_at: createdAt,
        decided_at: null,
        final_decision: null,
        confidence: null,
        rationale: null,
      },
    ]);

    const result = await createCouncilSession({
      taskId: "task-2",
      topic: "Patch rollout",
      objective: "Reduce risk",
      mode: "majority",
      createdBy: "mission-control",
    });

    expect(result.id).toBe("c-2");
    const query = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0][0] as string;
    expect(query).toContain("INSERT INTO mc_council_sessions");
    expect(query).toContain("'Patch rollout'");
  });

  it("submitVote updates member", async () => {
    await submitVote("c-3", 4, "approve", "looks good", 0.8);

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    const query = vi.mocked(prisma.$executeRawUnsafe).mock.calls[0][0] as string;
    expect(query).toContain("UPDATE mc_council_members");
    expect(query).toContain("vote = 'approve'");
    expect(query).toContain("id = 4");
  });

  it("finalizeDecision updates session", async () => {
    await finalizeDecision("c-4", { result: "approve" }, 0.95, "Consensus reached");

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    const query = vi.mocked(prisma.$executeRawUnsafe).mock.calls[0][0] as string;
    expect(query).toContain("UPDATE mc_council_sessions");
    expect(query).toContain("status = 'decided'");
    expect(query).toContain("confidence = 0.95");
  });
});
