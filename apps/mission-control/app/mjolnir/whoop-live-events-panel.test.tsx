import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WhoopLiveEventsPanel } from "@/components/mjolnir/whoop-live-events-panel";
import type { WhoopLiveEvent } from "@/lib/whoop-live-events";

function event(overrides?: Partial<WhoopLiveEvent>): WhoopLiveEvent {
  return {
    id: "1",
    triggerKey: "webhook:trace-1",
    source: "webhook",
    activityType: "workout",
    resourceId: "workout-1",
    status: "failed",
    traceId: "trace-1",
    summary: "Workout updated",
    metadata: { policy_reason: "Fresh WHOOP update is ready for Spartan coaching." },
    createdAt: "2026-05-09T12:00:00.000Z",
    updatedAt: "2026-05-09T12:01:00.000Z",
    ...overrides,
  };
}

describe("WhoopLiveEventsPanel", () => {
  it("renders webhook, cron, and manual activity together", () => {
    render(<WhoopLiveEventsPanel events={[
      event(),
      event({ id: "2", triggerKey: "cron:daily", source: "cron", status: "sent", traceId: null, summary: "Daily refresh" }),
      event({ id: "3", triggerKey: "manual:req", source: "manual", status: "no_reply", traceId: null, summary: "Manual fetch" }),
    ]} />);

    expect(screen.getByText("WHOOP Live Events")).toBeInTheDocument();
    expect(screen.getByText("Webhook")).toBeInTheDocument();
    expect(screen.getByText("Cron")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  it("requires confirmation before reprocessing a webhook event", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<WhoopLiveEventsPanel events={[event()]} />);
    fireEvent.click(screen.getByRole("button", { name: /reprocess/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/mjolnir/whoop-events/trace-1/reprocess",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ confirm: true, reason: "operator requested replay from Mjolnir" }),
      }),
    ));
  });
});
