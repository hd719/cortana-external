"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bot,
  Brain,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Dumbbell,
  FileText,
  GitBranch,
  LayoutDashboard,
  Menu,
  MessageCircle,
  Play,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "mc-sidebar-collapsed";

const links = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/task-board", label: "Task Board", icon: ClipboardList },
  { href: "/memories", label: "Memories", icon: Brain },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/jobs", label: "Jobs & Runs", icon: Play },
  { href: "/decisions", label: "Decision Traces", icon: GitBranch },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/feedback", label: "Feedback", icon: MessageCircle },
  { href: "/council", label: "Council", icon: Users },
  { href: "/fitness", label: "Fitness", icon: Dumbbell },
  { href: "/docs", label: "Docs", icon: FileText },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") {
      setCollapsed(true);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const desktopWidthClass = collapsed ? "md:w-16" : "md:w-60";

  return (
    <>
      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background px-4 md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="rounded-md p-2 text-foreground transition-colors hover:bg-muted"
          aria-label="Open navigation"
        >
          <Menu className="h-6 w-6" />
        </button>
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-primary/10 px-2.5 py-1 text-sm font-semibold text-foreground">
            Mission Control
          </div>
        </div>
      </div>

      <div className={cn("hidden shrink-0 transition-all duration-300 md:block", desktopWidthClass)} />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex max-md:w-60 flex-col border-r border-border bg-background transition-transform duration-300",
          desktopWidthClass,
          mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full md:translate-x-0"
        )}
      >
        <div className={cn("flex h-14 items-center border-b border-border px-4", collapsed && "md:justify-center md:px-2")}>
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="rounded-md bg-primary/10 px-2.5 py-1 text-sm font-semibold text-foreground">
              {!collapsed ? "Mission Control" : "MC"}
            </div>
            {!collapsed ? <Badge variant="outline" className="hidden md:inline-flex">v1</Badge> : null}
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="ml-auto rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
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
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    isActive && "bg-primary/10 text-foreground",
                    collapsed && "justify-center px-2"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className={cn("truncate", collapsed && "hidden")}>{link.label}</span>
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

      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close navigation backdrop"
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}
    </>
  );
}
