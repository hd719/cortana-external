import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTaskPrisma } from "@/lib/task-prisma";
import prisma from "@/lib/prisma";
import { getApprovalById, getApprovals, updateApprovalStatus } from "@/lib/approvals";

vi.mock("@/lib/task-prisma", () => ({
  getTaskPrisma: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
  },
}));

describe("lib/approvals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTaskPrisma).mockReturnValue(undefined);
  });

  it("getApprovals returns mapped rows and applies filters", async () => {
    const createdAt = new Date("2026-02-26T12:00:00.000Z");
    const latestEventAt = new Date("2026-02-26T12:30:00.000Z");

    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([
      {
        id: "apr-1",
        run_id: "run-1",
        task_id: "task-1",
        agent_id: "agent-1",
        action_type: "deploy",
        proposal: { target: "prod" },
        diff: { changed: true },
        rationale: "needed",
        risk_level: "p1",
        risk_score: 73,
        blast_radius: "service",
        auto_approvable: false,
        policy_version: "v1",
        status: "pending",
        decision: null,
        approved_by: null,
        approved_at: null,
        rejected_by: null,
        rejected_at: null,
        created_at: createdAt,
        expires_at: null,
        resumed_at: null,
        executed_at: null,
        execution_result: null,
        event_count: 2,
        latest_event_at: latestEventAt,
      },
    ]);

    const approvals = await getApprovals({ status: "pending", rangeHours: 48, limit: 25 });

    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      id: "apr-1",
      runId: "run-1",
      taskId: "task-1",
      status: "pending",
      riskLevel: "p1",
      eventCount: 2,
      createdAt: createdAt.toISOString(),
      latestEventAt: latestEventAt.toISOString(),
    });

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    const query = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0][0] as string;
    expect(query).toContain("INTERVAL '48 hours'");
    expect(query).toContain("r.status = 'pending'");
    expect(query).toContain("LIMIT 25");
  });

  it("getApprovals returns empty array when no rows", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([]);
    await expect(getApprovals()).resolves.toEqual([]);
  });

  it("getApprovals retries with prisma when task prisma fails", async () => {
    const taskClient = { $queryRawUnsafe: vi.fn().mockRejectedValueOnce(new Error("boom")) };
    vi.mocked(getTaskPrisma).mockReturnValue(taskClient as never);
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([]);

    await expect(getApprovals({ status: "approved" })).resolves.toEqual([]);

    expect(taskClient.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it("getApprovalById returns approval with events", async () => {
    const createdAt = new Date("2026-02-26T12:00:00.000Z");
    const eventTime = new Date("2026-02-26T12:10:00.000Z");

    vi.mocked(prisma.$queryRawUnsafe)
      .mockResolvedValueOnce([
        {
          id: "apr-1",
          run_id: "run-1",
          task_id: "task-1",
          agent_id: "agent-1",
          action_type: "deploy",
          proposal: {},
          diff: null,
          rationale: null,
          risk_level: "p2",
          risk_score: null,
          blast_radius: null,
          auto_approvable: true,
          policy_version: null,
          status: "pending",
          decision: null,
          approved_by: null,
          approved_at: null,
          rejected_by: null,
          rejected_at: null,
          created_at: createdAt,
          expires_at: null,
          resumed_at: null,
          executed_at: null,
          execution_result: null,
          event_count: 1,
          latest_event_at: eventTime,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 10,
          approval_id: "apr-1",
          event_type: "created",
          actor: "system",
          payload: { note: "started" },
          created_at: eventTime,
        },
      ]);

    const result = await getApprovalById("apr-1");

    expect(result?.id).toBe("apr-1");
    expect(result?.events).toHaveLength(1);
    expect(result?.events?.[0]).toMatchObject({ eventType: "created", actor: "system" });
    expect(vi.mocked(prisma.$queryRawUnsafe)).toHaveBeenCalledTimes(2);
  });

  it("getApprovalById returns null when not found", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(getApprovalById("missing")).resolves.toBeNull();
  });

  it("updateApprovalStatus approve flow updates and audits", async () => {
    await updateApprovalStatus("apr-1", "approve", { note: "ship" }, "hamel");

    const calls = vi.mocked(prisma.$executeRawUnsafe).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toContain("status = 'approved'");
    expect(calls[0][0]).toContain("approved_by");
    expect(calls[1][0]).toContain("INSERT INTO mc_approval_events");
    expect(calls[1][0]).toContain("'approve'");
  });

  it("updateApprovalStatus reject flow updates and audits", async () => {
    vi.clearAllMocks();

    await updateApprovalStatus("apr-2", "reject", { reason: "unsafe" }, "reviewer");

    const calls = vi.mocked(prisma.$executeRawUnsafe).mock.calls;
    expect(calls[0][0]).toContain("status = 'rejected'");
    expect(calls[0][0]).toContain("rejected_by");
    expect(calls[1][0]).toContain("'reject'");
  });

  it("updateApprovalStatus approve_edited flow updates and audits", async () => {
    vi.clearAllMocks();

    await updateApprovalStatus("apr-3", "approve_edited", { edit: true }, "editor");

    const calls = vi.mocked(prisma.$executeRawUnsafe).mock.calls;
    expect(calls[0][0]).toContain("status = 'approved_edited'");
    expect(calls[1][0]).toContain("'approve_edited'");
  });
});
