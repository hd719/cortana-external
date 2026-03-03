import { fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/sidebar";

const mockUsePathname = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

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

const NAV_LABELS = [
  "Dashboard",
  "System Stats",
  "Task Board",
  "Memories",
  "Agents",
  "Jobs & Runs",
  "Cron Jobs",
  "Decision Traces",
  "Approvals",
  "Feedback",
  "Council",
  "Fitness",
  "Sessions",
  "Usage",
  "Logs",
  "Docs",
];

const ICON_CLASSES = [
  ".lucide-layout-dashboard",
  ".lucide-activity",
  ".lucide-clipboard-list",
  ".lucide-brain",
  ".lucide-bot",
  ".lucide-play",
  ".lucide-clock",
  ".lucide-git-branch",
  ".lucide-shield-check",
  ".lucide-message-circle",
  ".lucide-users",
  ".lucide-dumbbell",
  ".lucide-timer",
  ".lucide-line-chart",
  ".lucide-scroll-text",
  ".lucide-file-text",
  ".lucide-chevron-left",
];

describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUsePathname.mockReturnValue("/");
  });

  it("renders all navigation links with correct labels", () => {
    render(<Sidebar />);

    for (const label of NAV_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    expect(screen.getAllByRole("link")).toHaveLength(NAV_LABELS.length);
  });

  it("renders all expected Lucide icons", () => {
    const { container } = render(<Sidebar />);

    for (const iconClass of ICON_CLASSES) {
      expect(container.querySelector(iconClass)).toBeInTheDocument();
    }
  });

  it("applies active class to the exact dashboard route only", () => {
    const { container, rerender } = render(<Sidebar />);

    const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboardLink.className).toContain("bg-primary/10");

    mockUsePathname.mockReturnValue("/docs");
    rerender(<Sidebar />);

    const dashboardLinkAfter = screen.getByRole("link", { name: "Dashboard" });
    const docsLink = screen.getByRole("link", { name: "Docs" });

    expect(dashboardLinkAfter.className).not.toContain("bg-primary/10");
    expect(docsLink.className).toContain("bg-primary/10");

    // Keep container referenced for lint/no-unused in some configs
    expect(container).toBeTruthy();
  });

  it("applies active class when pathname starts with non-dashboard href", () => {
    mockUsePathname.mockReturnValue("/jobs/123");
    render(<Sidebar />);

    const jobsLink = screen.getByRole("link", { name: "Jobs & Runs" });
    expect(jobsLink.className).toContain("bg-primary/10");
  });

  it("supports collapsed state with hidden labels and toggle", () => {
    localStorage.setItem("mc-sidebar-collapsed", "true");
    render(<Sidebar />);

    expect(screen.getByText("MC")).toBeInTheDocument();
    expect(screen.queryByText("Mission Control")).not.toBeInTheDocument();

    // In collapsed mode, nav links get title attributes for labels.
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("title", "Dashboard");

    const toggleButton = screen.getByRole("button", { name: "Expand sidebar" });
    expect(toggleButton).toBeInTheDocument();

    const toggleText = screen.getByText("Expand");
    expect(toggleText.className).toContain("hidden");
  });

  it("reads localStorage on mount and writes on toggle", () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    localStorage.setItem("mc-sidebar-collapsed", "true");
    render(<Sidebar />);

    expect(getItemSpy).toHaveBeenCalledWith("mc-sidebar-collapsed");

    const expandBtn = screen.getByRole("button", { name: "Expand sidebar" });
    fireEvent.click(expandBtn);

    expect(setItemSpy).toHaveBeenCalledWith("mc-sidebar-collapsed", "false");
  });
});
