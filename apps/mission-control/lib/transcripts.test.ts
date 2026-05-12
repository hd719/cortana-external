import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTaskPrisma } from "@/lib/task-prisma";
import prisma from "@/lib/prisma";
import { getTranscriptMessages } from "@/lib/transcripts";

vi.mock("@/lib/task-prisma", () => ({
  getTaskPrisma: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRawUnsafe: vi.fn(),
  },
}));

describe("lib/transcripts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTaskPrisma).mockReturnValue(null);
  });

  it("returns transcript messages with filters", async () => {
    const timestamp = new Date("2026-03-02T12:00:00.000Z");
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([
      {
        id: 11,
        session_id: "c-1",
        turn_no: 2,
        speaker_id: "monitor",
        message_type: "analysis",
        content: "Risk noted",
        metadata: null,
        created_at: timestamp,
        session_topic: "Ship",
        session_mode: "majority",
        session_status: "running",
        session_created_at: timestamp,
      },
    ]);

    const result = await getTranscriptMessages({
      rangeHours: 6,
      limit: 10,
      sessionId: "c-1",
      speakerId: "monitor",
      messageType: "analysis",
      query: "Risk",
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ sessionId: "c-1", speakerId: "monitor", messageType: "analysis" });
    expect(result.facets.speakers).toContain("monitor");

    const query = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0][0] as string;
    expect(query).toContain("INTERVAL '6 hours'");
    expect(query).toContain("m.session_id = 'c-1'");
    expect(query).toContain("m.speaker_id = 'monitor'");
    expect(query).toContain("m.message_type = 'analysis'");
    expect(query).toContain("ILIKE '%Risk%'");
    expect(query).toContain("LIMIT 10");
  });
});
