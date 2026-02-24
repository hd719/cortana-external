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
];

export function MainNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
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
              "rounded-md px-3 py-2 transition-colors",
              isActive
                ? "bg-primary/10 text-foreground"
                : "hover:text-foreground"
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
