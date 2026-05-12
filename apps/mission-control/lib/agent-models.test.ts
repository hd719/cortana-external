import { beforeEach, describe, expect, it, vi } from "vitest";

const readFileSyncMock = vi.fn();
const existsSyncMock = vi.fn();

vi.mock("node:fs", () => ({
  readFileSync: readFileSyncMock,
  existsSync: existsSyncMock,
  default: {
    readFileSync: readFileSyncMock,
    existsSync: existsSyncMock,
  },
}));

describe("lib/agent-models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.AGENT_MODELS_PATH = "/tmp/agent-models.json";
  });

  it("returns friendly display name when config is available", async () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(
      JSON.stringify({ Monitor: "openai-codex/gpt-5.3-codex" })
    );

    const { getAgentModelDisplay } = await import("@/lib/agent-models");
    const result = getAgentModelDisplay("Monitor");

    expect(result).toEqual({ key: "openai-codex/gpt-5.3-codex", displayName: "GPT 5.3 Codex" });
  });

  it("falls back to DB model when agent is not in config", async () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify({ Spartan: "openai-codex/gpt-5.3-codex" }));

    const { getAgentModelDisplay } = await import("@/lib/agent-models");
    const result = getAgentModelDisplay("Monitor", "openai-codex/gpt-5.1");

    expect(result).toEqual({ key: "openai-codex/gpt-5.1", displayName: "GPT 5.1" });
  });

  it("returns a formatted fallback when no runtime model registry is available", async () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue(JSON.stringify({ Librarian: "openai-codex/gpt-5.1" }));

    const { getAgentModelDisplay } = await import("@/lib/agent-models");
    const result = getAgentModelDisplay("Librarian");

    expect(result).toEqual({ key: "openai-codex/gpt-5.1", displayName: "GPT 5.1" });
  });

  it("returns nulls when no config and no DB model", async () => {
    existsSyncMock.mockReturnValue(false);

    const { getAgentModelDisplay } = await import("@/lib/agent-models");
    const result = getAgentModelDisplay("Unknown");

    expect(result).toEqual({ key: null, displayName: null });
  });

  it("getAgentModelMap handles missing and invalid config gracefully", async () => {
    const { getAgentModelMap } = await import("@/lib/agent-models");

    existsSyncMock.mockReturnValue(false);
    expect(getAgentModelMap()).toEqual({});

    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue("{invalid-json}");
    expect(getAgentModelMap()).toEqual({});
  });
});
