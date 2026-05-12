import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { MarketLabArtifactMissingError, readMarketLabArtifact } from "@/lib/market-lab";

vi.mock("@/lib/market-lab", async () => {
  const actual = await vi.importActual<typeof import("@/lib/market-lab")>("@/lib/market-lab");
  return {
    ...actual,
    readMarketLabArtifact: vi.fn(),
  };
});

describe("Market Lab artifact route", () => {
  beforeEach(() => {
    vi.mocked(readMarketLabArtifact).mockResolvedValue({
      kind: "codex_review",
      path: "/tmp/codex-review.md",
      contents: "# Codex Review: AAPL\nverdict trusted",
      size: 42,
      truncated: false,
    });
  });

  it("returns artifact contents for a known kind", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ runId: "mlab_test_AAPL", kind: "codex_review" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.contents).toContain("Codex Review");
    expect(body.data.truncated).toBe(false);
  });

  it("rejects unknown artifact kinds with 400", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ runId: "mlab_test_AAPL", kind: "secrets" }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/Unknown artifact kind/);
  });

  it("returns a friendly 404 when the artifact file is missing", async () => {
    vi.mocked(readMarketLabArtifact).mockRejectedValueOnce(
      new MarketLabArtifactMissingError("/tmp/missing.md", "Artifact file has not been generated yet."),
    );
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ runId: "mlab_test_AAPL", kind: "codex_review" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe("artifact_missing");
    expect(body.error).toMatch(/has not been generated/);
  });
});
