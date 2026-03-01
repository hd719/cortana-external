import { beforeEach, describe, expect, it, vi } from "vitest";

const executeRawMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  default: {
    $executeRawUnsafe: executeRawMock,
  },
}));

vi.mock("@/lib/task-prisma", () => ({
  getTaskPrisma: vi.fn(() => null),
}));

const execSyncMock = vi.fn();

vi.mock("node:child_process", () => ({
  execSync: execSyncMock,
  default: { execSync: execSyncMock },
}));

describe("POST /api/actions/[action] force-heartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts DB event and triggers openclaw system event", async () => {
    executeRawMock.mockResolvedValueOnce(1);
    execSyncMock.mockReturnValueOnce("ok");

    const { POST } = await import("@/app/api/actions/[action]/route");
    const res = await POST(new Request("http://localhost/api/actions/force-heartbeat", { method: "POST" }), {
      params: Promise.resolve({ action: "force-heartbeat" }),
    });

    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(executeRawMock).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO cortana_events")
    );
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('openclaw system event --text "Manual heartbeat forced from Mission Control" --mode now'),
      expect.objectContaining({ timeout: 15000 })
    );
  });
});
