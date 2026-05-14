import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StatusStrip } from "@/components/status-strip";

const jsonResponse = (payload: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => payload }) as Response;

describe("StatusStrip", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders all four status segments once their hooks resolve", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/heartbeat-status")) {
        return jsonResponse({ ok: true, lastHeartbeat: Date.now() - 60_000, status: "healthy", ageMs: 60_000 });
      }
      if (url.includes("/api/thinking-status")) {
        return jsonResponse({ ok: true, idle: false, current: "Indexing memex", items: ["Indexing memex"], updatedAt: new Date().toISOString() });
      }
      if (url.includes("/api/db-status")) {
        return jsonResponse({ postgres: true, lancedb: true });
      }
      return jsonResponse({});
    });

    render(<StatusStrip />);

    expect((await screen.findAllByText("LIVE")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Indexing memex")).length).toBeGreaterThan(0);
    expect(screen.getByText("PG")).toBeInTheDocument();
    expect(screen.getByText("Vector")).toBeInTheDocument();
    // Collapsed by default — <details> open attribute should be absent.
    expect(document.querySelector("details")?.hasAttribute("open")).toBe(false);
  });

  it('falls back to "—" tokens when hooks fail to load', async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({}, 500));

    render(<StatusStrip />);

    expect(screen.getAllByText("Systems nominal.").length).toBeGreaterThan(0);
    // Heartbeat label collapses to em-dash when status is unknown.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
