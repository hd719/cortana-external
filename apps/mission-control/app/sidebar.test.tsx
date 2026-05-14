import { fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/sidebar";

const mockUsePathname = vi.fn();
const storageState: Record<string, string> = {};

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
  "Sessions",
  "Services",
  "Trading Ops",
  "Mjolnir",
  "Memories",
  "Docs",
  "Jobs & Runs",
];


describe("Sidebar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    for (const key of Object.keys(storageState)) delete storageState[key];
    vi.spyOn(window.localStorage, "getItem").mockImplementation((key: string) =>
      key in storageState ? storageState[key] : null
    );
    vi.spyOn(window.localStorage, "setItem").mockImplementation((key: string, value: string) => {
      storageState[key] = String(value);
    });
    vi.spyOn(window.localStorage, "removeItem").mockImplementation((key: string) => {
      delete storageState[key];
    });
    vi.spyOn(window.localStorage, "clear").mockImplementation(() => {
      for (const key of Object.keys(storageState)) delete storageState[key];
    });
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
    localStorage.setItem("mc-sidebar-collapsed", "true");
    render(<Sidebar />);

    expect(localStorage.getItem).toHaveBeenCalledWith("mc-sidebar-collapsed");

    const expandBtn = screen.getByRole("button", { name: "Expand sidebar" });
    fireEvent.click(expandBtn);

    expect(localStorage.setItem).toHaveBeenCalledWith("mc-sidebar-collapsed", "false");
    expect(document.cookie).toContain("mc-sidebar-collapsed=false");
  });

  it("respects the server-provided initial collapsed state", () => {
    render(<Sidebar initialCollapsed />);

    expect(screen.getByText("MC")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });
});
