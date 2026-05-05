import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutonomyClient } from "./autonomy-client";
import type { AutonomyOpsSnapshot } from "@/lib/autonomy-ops";
import type { HumanRequiredAction } from "@/lib/human-required-actions";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const snapshot: AutonomyOpsSnapshot = {
  ok: true,
  stale: false,
  artifactPath: "/tmp/autonomy.json",
  data: {
    schemaVersion: "autonomy-ops.v1",
    generatedAt: "2026-05-05T12:00:00.000Z",
    freshUntil: "2026-05-05T12:10:00.000Z",
    operatorState: "watch",
    posture: "bounded",
    stale: false,
    counts: {
      autoRemediated: 2,
      escalated: 1,
      needsHuman: 1,
      actionable: 1,
      suppressed: 0,
    },
    sections: {
      autoFixed: ["feedback remediation completed"],
      degraded: ["gateway reachable but runtime stale"],
      waitingOnHamel: [],
      blockers: ["task dependency blocked"],
      familyCritical: { tracked: [], failures: 0, stricterEscalation: true },
      scorecard: { counts: {}, activeFollowUps: [] },
    },
    sources: [
      {
        key: "autonomy_status",
        label: "Autonomy status",
        required: true,
        status: "fresh",
        confidence: "high",
        generatedAt: "2026-05-05T12:00:00.000Z",
        freshUntil: "2026-05-05T12:10:00.000Z",
        detail: null,
      },
      {
        key: "session_lifecycle",
        label: "Session lifecycle",
        required: true,
        status: "stale",
        confidence: "medium",
        generatedAt: "2026-05-05T11:00:00.000Z",
        freshUntil: "2026-05-05T11:10:00.000Z",
        detail: "session stale",
      },
    ],
  },
};

const humanAction: HumanRequiredAction = {
  id: 7,
  system: "schwab",
  category: "auth",
  severity: "critical",
  status: "open",
  summary: "Schwab login required",
  requiredAction: "Open Services and re-auth Schwab.",
  lastSeenAt: "2026-05-05T12:01:00.000Z",
  dueAt: null,
  verificationKey: null,
  alertCount: 1,
  detectionCount: 1,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("AutonomyClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders Autonomy operational cards and rows as clickable links", () => {
    render(<AutonomyClient initialSnapshot={snapshot} initialHumanActions={[humanAction]} initialHumanActionsError={null} />);

    expect(screen.getByRole("link", { name: "Open Auto-fixed" })).toHaveAttribute("href", "/feedback?source=system&remediationStatus=resolved&rangeHours=168");
    expect(screen.getByRole("link", { name: "Open Escalated" })).toHaveAttribute("href", "/approvals?status=pending&rangeHours=168");
    expect(screen.getByRole("link", { name: "Open Human-required" })).toHaveAttribute("href", "/services");
    expect(screen.getByRole("link", { name: "WATCH" })).toHaveAttribute("href", "/api/autonomy-ops");

    expect(screen.getByRole("link", { name: /Schwab login required/i })).toHaveAttribute("href", "/services");
    expect(screen.getByRole("link", { name: /Session lifecycle/i })).toHaveAttribute("href", "/sessions");
    expect(screen.getByRole("link", { name: /feedback remediation completed/i })).toHaveAttribute("href", "/feedback");
    expect(screen.getByRole("link", { name: /gateway reachable but runtime stale/i })).toHaveAttribute("href", "/services");
    expect(screen.getByRole("link", { name: /task dependency blocked/i })).toHaveAttribute("href", "/task-board");
  });

  it("refreshes autonomy and human-required data from clickable action", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/autonomy-ops/refresh") {
        return new Response(JSON.stringify({
          ...snapshot,
          data: { ...snapshot.data, operatorState: "live", counts: { ...snapshot.data.counts, autoRemediated: 3 } },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "/api/human-required-actions") {
        return new Response(JSON.stringify({ ok: true, items: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AutonomyClient initialSnapshot={snapshot} initialHumanActions={[humanAction]} initialHumanActionsError={null} />);

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/autonomy-ops/refresh", { method: "POST", cache: "no-store" });
      expect(fetchMock).toHaveBeenCalledWith("/api/human-required-actions", { cache: "no-store" });
    });
    await waitFor(() => expect(screen.getByRole("link", { name: "LIVE" })).toBeInTheDocument());
    expect(screen.getByText("No open human-required actions.")).toBeInTheDocument();
  });

  it("keeps the tab responsive while a slow autonomy refresh is pending", async () => {
    const autonomyRefresh = deferred<Response>();
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/autonomy-ops/refresh") {
        return autonomyRefresh.promise;
      }
      if (url === "/api/human-required-actions") {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, items: [] }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AutonomyClient initialSnapshot={snapshot} initialHumanActions={[humanAction]} initialHumanActionsError={null} />);

    const refreshButton = screen.getByRole("button", { name: /^refresh$/i });
    fireEvent.click(refreshButton);

    expect(await screen.findByText(/Refreshing autonomy artifact/i)).toBeInTheDocument();
    expect(refreshButton).toBeDisabled();
    expect(screen.getByRole("link", { name: /Schwab login required/i })).toHaveAttribute("href", "/services");

    autonomyRefresh.resolve(new Response(JSON.stringify({
      ...snapshot,
      data: { ...snapshot.data, operatorState: "live", counts: { ...snapshot.data.counts, autoRemediated: 3 } },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await waitFor(() => expect(refreshButton).not.toBeDisabled());
    expect(screen.queryByText(/Refreshing autonomy artifact/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "LIVE" })).toBeInTheDocument();
  });
});
