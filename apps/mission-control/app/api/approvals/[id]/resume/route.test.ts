import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/approvals/[id]/resume/route";
import { getApprovalById, recordExecution, resumeApproval } from "@/lib/approvals";

vi.mock("@/lib/approvals", () => ({
  getApprovalById: vi.fn(),
  resumeApproval: vi.fn(),
  recordExecution: vi.fn(),
}));

describe("POST /api/approvals/[id]/resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects malformed approval ids before querying", async () => {
    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "not-real" }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid approval id");
    expect(getApprovalById).not.toHaveBeenCalled();
    expect(resumeApproval).not.toHaveBeenCalled();
    expect(recordExecution).not.toHaveBeenCalled();
  });

  it("requires an approved request before resuming", async () => {
    vi.mocked(getApprovalById).mockResolvedValueOnce({ id: "11111111-1111-4111-8111-111111111111", status: "pending" } as never);

    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Approval must be approved before resume");
    expect(resumeApproval).not.toHaveBeenCalled();
  });

  it("requests resume with the merged approval payload", async () => {
    vi.mocked(resumeApproval).mockResolvedValueOnce();
    vi.mocked(getApprovalById)
      .mockResolvedValueOnce({
        id: "11111111-1111-4111-8111-111111111111",
        status: "approved",
        proposal: { task: "deploy" },
        resumePayload: { target: "prod" },
        resumedAt: null,
        executedAt: null,
        agentId: "monitor",
      } as never)
      .mockResolvedValueOnce({
        id: "11111111-1111-4111-8111-111111111111",
        status: "approved",
        proposal: { task: "deploy" },
        resumePayload: { target: "prod" },
        resumedAt: "2026-02-26T12:00:00.000Z",
        executedAt: null,
        agentId: "monitor",
      } as never);

    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({
        actor: "mission-control-ui",
        payload: { note: "resume from inbox" },
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });
    const body = await response.json();

    expect(resumeApproval).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", "mission-control-ui", {
      proposal: { task: "deploy" },
      resume_payload: { target: "prod" },
      note: "resume from inbox",
    });
    expect(response.status).toBe(200);
    expect(body.approval.resumedAt).toBe("2026-02-26T12:00:00.000Z");
  });

  it("records execution results for approved requests", async () => {
    vi.mocked(recordExecution).mockResolvedValueOnce();
    vi.mocked(getApprovalById)
      .mockResolvedValueOnce({
        id: "11111111-1111-4111-8111-111111111111",
        status: "approved_edited",
        proposal: { task: "deploy" },
        resumePayload: null,
        resumedAt: null,
        executedAt: null,
        agentId: "monitor",
      } as never)
      .mockResolvedValueOnce({
        id: "11111111-1111-4111-8111-111111111111",
        status: "approved_edited",
        proposal: { task: "deploy" },
        resumePayload: null,
        resumedAt: "2026-02-26T12:00:00.000Z",
        executedAt: "2026-02-26T12:05:00.000Z",
        agentId: "monitor",
      } as never);

    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({
        actor: "mission-control-ui",
        execution_result: { status: "completed", note: "done" },
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });
    const body = await response.json();

    expect(recordExecution).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", { status: "completed", note: "done" }, "mission-control-ui");
    expect(response.status).toBe(200);
    expect(body.approval.executedAt).toBe("2026-02-26T12:05:00.000Z");
  });

  it("rejects duplicate resume requests", async () => {
    vi.mocked(getApprovalById).mockResolvedValueOnce({
      id: "11111111-1111-4111-8111-111111111111",
      status: "approved",
      resumedAt: "2026-02-26T12:00:00.000Z",
      executedAt: null,
      proposal: {},
      resumePayload: null,
      agentId: "monitor",
    } as never);

    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("Resume already requested");
  });

  it("rejects duplicate execution records", async () => {
    vi.mocked(getApprovalById).mockResolvedValueOnce({
      id: "11111111-1111-4111-8111-111111111111",
      status: "approved",
      resumedAt: "2026-02-26T12:00:00.000Z",
      executedAt: "2026-02-26T12:05:00.000Z",
      proposal: {},
      resumePayload: null,
      agentId: "monitor",
    } as never);

    const response = await POST(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ execution_result: { status: "completed" } }),
    }), {
      params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("Execution already recorded");
  });
});
