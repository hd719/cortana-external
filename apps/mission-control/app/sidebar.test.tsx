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
  "Mjolnir",
  "Sessions",
  "Usage",
  "Logs",
  "Docs",
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
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }

    expect(screen.getAllByRole("link").length).toBeGreaterThanOrEqual(NAV_LABELS.length);
  });

  it("renders navigation and toggle icons", () => {
    const { container } = render(<Sidebar />);

    const lucideIcons = container.querySelectorAll("svg.lucide");
    // One icon per nav item + one toggle icon in footer.
    expect(lucideIcons.length).toBeGreaterThanOrEqual(NAV_LABELS.length + 1);
  });

  it("applies active class to the exact dashboard route only", () => {
    const { container, rerender } = render(<Sidebar />);

    const dashboardLinks = screen.getAllByRole("link", { name: "Dashboard" });
    expect(dashboardLinks.some((el) => el.className.includes("bg-primary/10"))).toBe(true);

    mockUsePathname.mockReturnValue("/docs");
    rerender(<Sidebar />);

    const dashboardLinksAfter = screen.getAllByRole("link", { name: "Dashboard" });
    const docsLinks = screen.getAllByRole("link", { name: "Docs" });

    expect(dashboardLinksAfter.some((el) => el.className.includes("bg-primary/10"))).toBe(false);
    expect(docsLinks.some((el) => el.className.includes("bg-primary/10"))).toBe(true);

    // Keep container referenced for lint/no-unused in some configs
    expect(container).toBeTruthy();
  });

  it("applies active class when pathname starts with non-dashboard href", () => {
    mockUsePathname.mockReturnValue("/jobs/123");
    render(<Sidebar />);

    const jobsLinks = screen.getAllByRole("link", { name: "Jobs & Runs" });
    expect(jobsLinks.some((el) => el.className.includes("bg-primary/10"))).toBe(true);
  });

  it("supports collapsed state with hidden desktop labels and toggle", () => {
    localStorage.setItem("mc-sidebar-collapsed", "true");
    render(<Sidebar />);

    expect(screen.getByText("MC")).toBeInTheDocument();
    // Mobile header always shows Mission Control; ensure desktop collapsed marker is present.
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();

    // In collapsed mode, at least one desktop nav link gets title attributes for labels.
    const dashboardLinks = screen.getAllByRole("link", { name: "Dashboard" });
    expect(dashboardLinks.some((el) => el.getAttribute("title") === "Dashboard")).toBe(true);

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
