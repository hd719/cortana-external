import { describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { reconcileStaleRuns } from "@/lib/run-reconciliation";

vi.mock("@/lib/prisma", () => ({
  default: {
    $executeRawUnsafe: vi.fn(),
  },
}));

describe("lib/run-reconciliation", () => {
  it("reconcileStaleRuns marks old runs completed", async () => {
    vi.mocked(prisma.$executeRawUnsafe).mockResolvedValueOnce(3);

    const result = await reconcileStaleRuns(45);

    expect(result).toBe(3);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    const query = vi.mocked(prisma.$executeRawUnsafe).mock.calls[0][0] as string;
    expect(query).toContain("UPDATE \"Run\"");
    expect(query).toContain("status = 'completed'");
    expect(query).toContain("INTERVAL '45 minutes'");
  });
});
