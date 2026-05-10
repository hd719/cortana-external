"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useState } from "react";
import {
  Brain,
  Activity,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  PlugZap,
  Dumbbell,
  FileText,
  FlaskConical,
  GitBranch,
  Landmark,
  LayoutDashboard,
  MessageCircle,
  MessageSquareText,
  Play,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "mc-sidebar-collapsed";
const COOKIE_KEY = "mc-sidebar-collapsed";

const links = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/autonomy", label: "Autonomy", icon: Activity },
  { href: "/sessions", label: "Sessions", icon: MessageSquareText },
  { href: "/services", label: "Services", icon: PlugZap },
  { href: "/trading-ops", label: "Trading Ops", icon: Landmark },
  { href: "/market-lab", label: "Market Lab", icon: FlaskConical },
  { href: "/task-board", label: "Task Board", icon: ClipboardList },
  { href: "/mjolnir", label: "Mjolnir", icon: Dumbbell },
  { href: "/memories", label: "Memories", icon: Brain },
  { href: "/docs", label: "Docs", icon: FileText },
  { href: "/jobs", label: "Jobs & Runs", icon: Play },
  { href: "/decisions", label: "Decision Traces", icon: GitBranch },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/feedback", label: "Feedback", icon: MessageCircle },
];

const readStoredCollapsed = () => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value == null) return null;
    return value === "true";
  } catch {
    return null;
  }
};

const persistCollapsed = (collapsed: boolean) => {
  try {
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  } catch {
    // Ignore storage failures in restricted contexts.
  }

  document.cookie = `${COOKIE_KEY}=${collapsed ? "true" : "false"}; Path=/; Max-Age=31536000; SameSite=Lax`;
};

export function Sidebar({ initialCollapsed = false }: { initialCollapsed?: boolean }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const stored = readStoredCollapsed();
    if (stored != null) {
      setCollapsed(stored);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    persistCollapsed(collapsed);
  }, [collapsed, ready]);

  const desktopWidthClass = collapsed ? "md:w-16" : "md:w-60";
  const desktopTransitionClass = ready ? "md:transition-[width] md:duration-300" : "md:transition-none";

  return (
    <>
      <div className={cn("hidden shrink-0 w-16 md:block", desktopWidthClass, desktopTransitionClass)} />

      <div className="fixed inset-x-0 top-0 z-40 border-b border-border bg-background/95 backdrop-blur md:hidden">
        <div className="px-4 py-2 text-sm font-semibold text-foreground">Mission Control</div>
        <nav className="flex items-center gap-1 overflow-x-auto px-2 pb-2">
          {links.map((link) => {
            const isActive = link.href === "/" ? pathname === link.href : pathname?.startsWith(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={`mobile-${link.href}`}
                href={link.href}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground",
                  "hover:bg-muted hover:text-foreground",
                  isActive && "bg-primary/10 text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden w-16 flex-col overflow-hidden border-r border-border bg-background md:flex",
          desktopWidthClass,
          desktopTransitionClass
        )}
      >
        <div className={cn("flex h-14 items-center border-b border-border px-2 md:px-4", collapsed ? "justify-center md:px-2" : "justify-start")}>
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="rounded-md bg-primary/10 px-2.5 py-1 text-sm font-semibold text-foreground">
              {!collapsed ? "Mission Control" : "MC"}
            </div>
            {!collapsed ? <Badge variant="outline" className="hidden md:inline-flex">v1</Badge> : null}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          <div className="space-y-1">
            {links.map((link) => {
              const isActive =
                link.href === "/"
                  ? pathname === link.href
                  : pathname?.startsWith(link.href);
              const Icon = link.icon;

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  title={collapsed ? link.label : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground justify-center md:px-3",
                    isActive && "bg-primary/10 text-foreground",
                    collapsed && "md:justify-center md:px-2",
                    !collapsed && "md:justify-start"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className={cn("truncate hidden md:inline", collapsed && "md:hidden")}>{link.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-border p-3">
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            className={cn(
              "hidden w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:flex",
              collapsed && "justify-center px-2"
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            <span className={cn(collapsed && "hidden")}>{collapsed ? "Expand" : "Collapse"}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
