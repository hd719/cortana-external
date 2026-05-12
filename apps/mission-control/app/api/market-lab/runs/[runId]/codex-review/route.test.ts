import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { createCodexSessionRun } from "@/lib/codex-session-workspace";
import { getMarketLabCodexPacket } from "@/lib/market-lab";

vi.mock("@/lib/codex-session-workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/codex-session-workspace")>();
  return {
    ...actual,
    createCodexSessionRun: vi.fn(),
  };
});

vi.mock("@/lib/market-lab", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/market-lab")>();
  return {
    ...actual,
    getMarketLabCodexPacket: vi.fn(),
  };
});

const sameOriginPost = () =>
  new Request("http://localhost/api/market-lab/runs/mlab_test_AAPL/codex-review", {
    method: "POST",
    headers: {
      host: "localhost",
      origin: "http://localhost",
    },
  });

describe("Market Lab Codex review route", () => {
  beforeEach(() => {
    vi.mocked(getMarketLabCodexPacket).mockResolvedValue({
      run_id: "mlab_test_AAPL",
      packet_path: "/tmp/codex-review-packet.md",
      prompt: "Read the packet.",
    });
    vi.mocked(createCodexSessionRun).mockResolvedValue({ streamId: "stream-1" });
  });

  it("starts a Codex session from the review packet", async () => {
    const response = await POST(sameOriginPost(), { params: Promise.resolve({ runId: "mlab_test_AAPL" }) });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(getMarketLabCodexPacket).toHaveBeenCalledWith("mlab_test_AAPL");
    expect(createCodexSessionRun).toHaveBeenCalledWith({
      prompt: "Read the packet.",
      workspaceKey: "cortana-external",
    });
    expect(body.data.streamId).toBe("stream-1");
    expect(body.data.packet_path).toBe("/tmp/codex-review-packet.md");
  });
});
