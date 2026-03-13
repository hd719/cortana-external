import { beforeEach, describe, expect, it, vi } from "vitest";

const executeRawMock = vi.fn();
const readFileSyncMock = vi.fn();
const existsSyncMock = vi.fn();

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

vi.mock("node:fs", () => ({
  readFileSync: readFileSyncMock,
  existsSync: existsSyncMock,
  default: {
    readFileSync: readFileSyncMock,
    existsSync: existsSyncMock,
  },
}));

describe("POST /api/actions/[action] force-heartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CORTANA_SOURCE_REPO;
    delete process.env.TELEGRAM_USAGE_HANDLER_PATH;
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

describe("POST /api/actions/[action] check-budget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CORTANA_SOURCE_REPO;
    delete process.env.TELEGRAM_USAGE_HANDLER_PATH;
  });

  it("uses the canonical Cortana telegram usage handler when quota tracker is absent", async () => {
    existsSyncMock.mockReturnValueOnce(false);
    execSyncMock.mockReturnValueOnce(
      JSON.stringify({ used: 12, remaining: 88, burnRate: 1.5 })
    );

    const { POST } = await import("@/app/api/actions/[action]/route");
    const res = await POST(new Request("http://localhost/api/actions/check-budget", { method: "POST" }), {
      params: Promise.resolve({ action: "check-budget" }),
    });
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.budget).toMatchObject({
      source: "telegram-usage",
      used: 12,
      remaining: 88,
      burnRate: 1.5,
    });
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining("/Users/hd/Developer/cortana/skills/telegram-usage/handler.ts"),
      expect.objectContaining({ timeout: 10000 })
    );
  });

  it("respects TELEGRAM_USAGE_HANDLER_PATH overrides", async () => {
    process.env.TELEGRAM_USAGE_HANDLER_PATH = "/tmp/custom-telegram-usage.ts";
    existsSyncMock.mockReturnValueOnce(false);
    execSyncMock.mockReturnValueOnce(
      JSON.stringify({ spendToDate: 20, budget_remaining: 80, dailyBurnRate: 2 })
    );

    const { POST } = await import("@/app/api/actions/[action]/route");
    const res = await POST(new Request("http://localhost/api/actions/check-budget", { method: "POST" }), {
      params: Promise.resolve({ action: "check-budget" }),
    });
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining("/tmp/custom-telegram-usage.ts"),
      expect.objectContaining({ timeout: 10000 })
    );
  });
});
