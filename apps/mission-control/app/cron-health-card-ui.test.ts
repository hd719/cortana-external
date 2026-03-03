import { describe, expect, it } from "vitest";
import { getActionUi, getDisplayStatus } from "@/components/cron-health-card";

describe("cron health card UI mapping", () => {
  it("maps legacy late status to overdue display status", () => {
    expect(getDisplayStatus({ status: "late" })).toBe("overdue");
    expect(getDisplayStatus({ status: "healthy" })).toBe("healthy");
  });

  it("maps action recommendation to visible badge copy", () => {
    expect(getActionUi("run-now")?.label).toBe("Action: Run now");
    expect(getActionUi("watch")?.label).toBe("Action: Watch");
    expect(getActionUi("investigate")?.label).toBe("Action: Investigate");
    expect(getActionUi(null)).toBeNull();
  });
});
