import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { getCodexRun } from "@/lib/codex-runs";
import { createCodexSessionRun } from "@/lib/codex-session-workspace";
import { getMarketLabCodexPacket, getMarketLabRun } from "@/lib/market-lab";

vi.mock("@/lib/codex-runs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/codex-runs")>();
  return {
    ...actual,
    getCodexRun: vi.fn(),
  };
});

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
    getMarketLabRun: vi.fn(),
  };
});

const sameOriginPost = (runId = "mlab_test_AAPL") =>
  new Request(`http://localhost/api/market-lab/runs/${runId}/codex-review`, {
    method: "POST",
    headers: {
      host: "localhost",
      origin: "http://localhost",
    },
  });

describe("Market Lab Codex review route", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "market-lab-codex-route-"));
    vi.clearAllMocks();
    vi.mocked(getCodexRun).mockReturnValue(null);
    vi.mocked(getMarketLabRun).mockResolvedValue({
      review: {
        codex_review: null,
        artifact_paths: { codex_packet: path.join(tempDir, "codex-review-packet.md") },
      },
    } as Awaited<ReturnType<typeof getMarketLabRun>>);
    vi.mocked(getMarketLabCodexPacket).mockResolvedValue({
      run_id: "mlab_test_AAPL",
      packet_path: path.join(tempDir, "codex-review-packet.md"),
      prompt: "Read the packet.",
    });
    vi.mocked(createCodexSessionRun).mockResolvedValue({ streamId: "stream-1" });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("starts a Codex session from the review packet", async () => {
    const response = await POST(sameOriginPost("mlab_route_start_AAPL"), { params: Promise.resolve({ runId: "mlab_route_start_AAPL" }) });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(getMarketLabCodexPacket).toHaveBeenCalledWith("mlab_route_start_AAPL");
    expect(createCodexSessionRun).toHaveBeenCalledWith({
      prompt: "Read the packet.",
      workspaceKey: "cortana-external",
    });
    expect(body.data.status).toBe("running");
    expect(body.data.streamId).toBe("stream-1");
    expect(body.data.packet_path).toBe(path.join(tempDir, "codex-review-packet.md"));
  });

  it("reuses an active Codex review for duplicate clicks on the same run", async () => {
    const first = await POST(sameOriginPost("mlab_route_duplicate_AAPL"), { params: Promise.resolve({ runId: "mlab_route_duplicate_AAPL" }) });
    expect(first.status).toBe(202);

    vi.mocked(getCodexRun).mockReturnValue({ status: "running" } as ReturnType<typeof getCodexRun>);

    const second = await POST(sameOriginPost("mlab_route_duplicate_AAPL"), { params: Promise.resolve({ runId: "mlab_route_duplicate_AAPL" }) });
    const body = await second.json();

    expect(second.status).toBe(202);
    expect(createCodexSessionRun).toHaveBeenCalledTimes(1);
    expect(body.data).toMatchObject({
      status: "running",
      streamId: "stream-1",
      packet_path: path.join(tempDir, "codex-review-packet.md"),
      reused: true,
    });
  });

  it("reuses a persisted Codex review request after in-memory stream state is gone", async () => {
    const runId = "mlab_route_persisted_AAPL";
    const first = await POST(sameOriginPost(runId), { params: Promise.resolve({ runId }) });
    expect(first.status).toBe(202);

    vi.mocked(getCodexRun).mockReturnValue(null);

    const second = await POST(sameOriginPost(runId), { params: Promise.resolve({ runId }) });
    const body = await second.json();

    expect(second.status).toBe(202);
    expect(createCodexSessionRun).toHaveBeenCalledTimes(1);
    expect(body.data).toMatchObject({
      status: "already_requested",
      streamId: "stream-1",
      packet_path: path.join(tempDir, "codex-review-packet.md"),
      reused: true,
    });
  });

  it("reports persisted Codex review request state on refresh", async () => {
    const runId = "mlab_route_state_AAPL";
    await POST(sameOriginPost(runId), { params: Promise.resolve({ runId }) });

    const response = await GET(sameOriginPost(runId), { params: Promise.resolve({ runId }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      status: "already_requested",
      streamId: "stream-1",
      packet_path: path.join(tempDir, "codex-review-packet.md"),
      reused: true,
    });
  });

  it("does not start a new Codex session once the review is attached", async () => {
    vi.mocked(getMarketLabRun).mockResolvedValueOnce({
      review: {
        codex_review: { status: "attached", output_path: "/tmp/codex-review.md" },
        artifact_paths: { codex_packet: path.join(tempDir, "codex-review-packet.md") },
      },
    } as Awaited<ReturnType<typeof getMarketLabRun>>);

    const response = await POST(sameOriginPost("mlab_route_attached_AAPL"), { params: Promise.resolve({ runId: "mlab_route_attached_AAPL" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createCodexSessionRun).not.toHaveBeenCalled();
    expect(body.data.status).toBe("already_attached");
    expect(body.data.packet_path).toBe(path.join(tempDir, "codex-review-packet.md"));
  });
});
