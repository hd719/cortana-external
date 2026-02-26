"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/task-board", label: "Task Board" },
  { href: "/agents", label: "Agents" },
  { href: "/jobs", label: "Jobs & Runs" },
  { href: "/decisions", label: "Decision Traces" },
  { href: "/approvals", label: "Approvals" },
  { href: "/feedback", label: "Feedback" },
  { href: "/council", label: "Council" },
];

export function MainNav() {
  const pathname = usePathname();

  return (
    <nav className="w-full overflow-x-auto pb-1 sm:w-auto sm:overflow-visible sm:pb-0">
      <div className="flex min-w-max items-center gap-2 text-sm font-medium text-muted-foreground">
        {links.map((link) => {
          const isActive =
            link.href === "/"
              ? pathname === link.href
              : pathname?.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-md px-3 py-2 transition-colors",
                isActive
                  ? "bg-primary/10 text-foreground"
                  : "hover:text-foreground"
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
