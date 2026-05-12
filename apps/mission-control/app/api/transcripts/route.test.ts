import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/transcripts/route";
import { getTranscriptMessages } from "@/lib/transcripts";

vi.mock("@/lib/transcripts", () => ({
  getTranscriptMessages: vi.fn(),
}));

describe("/api/transcripts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET returns transcript payload with parsed filters", async () => {
    vi.mocked(getTranscriptMessages).mockResolvedValueOnce({
      messages: [],
      facets: { speakers: [], messageTypes: [], sessions: [] },
      source: "cortana",
    });

    const request = new Request(
      "http://localhost/api/transcripts?rangeHours=12&limit=10&sessionId=c-1&speakerId=monitor&messageType=analysis&query=Risk",
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      messages: [],
      facets: { speakers: [], messageTypes: [], sessions: [] },
      source: "cortana",
    });
    expect(getTranscriptMessages).toHaveBeenCalledWith({
      rangeHours: 12,
      limit: 10,
      sessionId: "c-1",
      speakerId: "monitor",
      messageType: "analysis",
      query: "Risk",
    });
  });
});
