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

const readFileMock = vi.fn();
const writeFileMock = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
}));

describe("POST /api/actions/[action] force-heartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates heartbeat-state.json and inserts DB event", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    executeRawMock.mockResolvedValueOnce(1);
    readFileMock.mockResolvedValueOnce(JSON.stringify({ lastHeartbeat: 1, foo: "bar" }));
    writeFileMock.mockResolvedValueOnce(undefined);

    const { POST } = await import("@/app/api/actions/[action]/route");
    const res = await POST(new Request("http://localhost/api/actions/force-heartbeat", { method: "POST" }), {
      params: Promise.resolve({ action: "force-heartbeat" }),
    });

    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(executeRawMock).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO cortana_events")
    );
    expect(writeFileMock).toHaveBeenCalledTimes(1);

    const writtenJson = JSON.parse(writeFileMock.mock.calls[0][1]);
    expect(writtenJson.lastHeartbeat).toBe(1_700_000_000_000);
    expect(writtenJson.foo).toBe("bar");
  });
});
