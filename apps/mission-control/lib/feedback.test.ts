import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTaskPrisma } from "@/lib/task-prisma";
import prisma from "@/lib/prisma";
import {
  addFeedbackAction,
  createFeedback,
  getFeedbackById,
  getFeedbackItems,
  getFeedbackMetrics,
  updateFeedbackStatus,
} from "@/lib/feedback";

vi.mock("@/lib/task-prisma", () => ({
  getTaskPrisma: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
  },
}));

describe("lib/feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTaskPrisma).mockReturnValue(undefined);
  });

  it("getFeedbackItems returns filtered listing", async () => {
    const createdAt = new Date("2026-02-26T12:00:00.000Z");
    const updatedAt = new Date("2026-02-26T12:05:00.000Z");

    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([
      {
        id: "fb-1",
        run_id: "run-1",
        task_id: "task-1",
        agent_id: "agent-1",
        source: "user",
        category: "ux",
        severity: "high",
        summary: "Buttons overlap",
        details: { viewport: "mobile" },
        recurrence_key: null,
        status: "new",
        owner: null,
        created_at: createdAt,
        updated_at: updatedAt,
        action_count: 3,
      },
    ]);

    const items = await getFeedbackItems({ status: "new", severity: "high", source: "user", rangeHours: 24, limit: 10 });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "fb-1",
      source: "user",
      severity: "high",
      status: "new",
      actionCount: 3,
      createdAt: createdAt.toISOString(),
    });

    const query = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0][0] as string;
    expect(query).toContain("INTERVAL '24 hours'");
    expect(query).toContain("f.status = 'new'");
    expect(query).toContain("f.severity = 'high'");
    expect(query).toContain("f.source = 'user'");
    expect(query).toContain("LIMIT 10");
  });

  it("getFeedbackItems handles empty results", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([]);
    await expect(getFeedbackItems()).resolves.toEqual([]);
  });

  it("getFeedbackById returns item with actions", async () => {
    const createdAt = new Date("2026-02-26T12:00:00.000Z");
    const updatedAt = new Date("2026-02-26T12:10:00.000Z");
    const actionAt = new Date("2026-02-26T12:15:00.000Z");

    vi.mocked(prisma.$queryRawUnsafe)
      .mockResolvedValueOnce([
        {
          id: "fb-1",
          run_id: null,
          task_id: null,
          agent_id: null,
          source: "system",
          category: "reliability",
          severity: "medium",
          summary: "retry spike",
          details: { retries: 10 },
          recurrence_key: "rec-1",
          status: "triaged",
          owner: "hamel",
          created_at: createdAt,
          updated_at: updatedAt,
          action_count: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 1,
          feedback_id: "fb-1",
          action_type: "opened_pr",
          action_ref: "#123",
          description: "fix submitted",
          status: "applied",
          created_at: actionAt,
          verified_at: null,
        },
      ]);

    const result = await getFeedbackById("fb-1");

    expect(result?.id).toBe("fb-1");
    expect(result?.actions).toHaveLength(1);
    expect(result?.actions?.[0]).toMatchObject({ actionType: "opened_pr", actionRef: "#123" });
  });

  it("createFeedback inserts and returns id", async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([{ id: "fb-new" }]);

    const id = await createFeedback({
      source: "user",
      category: "ux",
      severity: "low",
      summary: "nit",
      details: { foo: "bar" },
    });

    expect(id).toBe("fb-new");
    const sql = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0][0] as string;
    expect(sql).toContain("INSERT INTO mc_feedback_items");
    expect(sql).toContain("'user'");
    expect(sql).toContain("'ux'");
  });

  it("updateFeedbackStatus applies status transition", async () => {
    await updateFeedbackStatus("fb-1", "verified", "owner-1");

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    const sql = vi.mocked(prisma.$executeRawUnsafe).mock.calls[0][0] as string;
    expect(sql).toContain("status = 'verified'");
    expect(sql).toContain("owner = 'owner-1'");
  });

  it("addFeedbackAction creates action linked to feedback", async () => {
    await addFeedbackAction("fb-1", {
      actionType: "create_issue",
      actionRef: "ISSUE-1",
      description: "filed",
      status: "planned",
    });

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    const sql = vi.mocked(prisma.$executeRawUnsafe).mock.calls[0][0] as string;
    expect(sql).toContain("INSERT INTO mc_feedback_actions");
    expect(sql).toContain("'fb-1'");
    expect(sql).toContain("'create_issue'");
  });

  it("getFeedbackMetrics returns aggregated counts and trends", async () => {
    vi.mocked(prisma.$queryRawUnsafe)
      .mockResolvedValueOnce([
        { severity: "low", count: 2 },
        { severity: "high", count: 1 },
      ])
      .mockResolvedValueOnce([
        { status: "new", count: 1 },
        { status: "verified", count: 2 },
      ])
      .mockResolvedValueOnce([
        { category: "ux", count: 2 },
        { category: "reliability", count: 1 },
      ])
      .mockResolvedValueOnce([
        { day: "2026-02-25", count: 1 },
        { day: "2026-02-26", count: 2 },
      ]);

    const metrics = await getFeedbackMetrics();

    expect(metrics).toEqual({
      bySeverity: { low: 2, high: 1 },
      byStatus: { new: 1, verified: 2 },
      byCategory: { ux: 2, reliability: 1 },
      dailyCorrections: [
        { day: "2026-02-25", count: 1 },
        { day: "2026-02-26", count: 2 },
      ],
    });
  });
});
