"use client";

import { usePathname, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";

const statuses = ["all", "new", "triaged", "in_progress", "verified", "wont_fix"] as const;
const remediationStatuses = ["all", "open", "in_progress", "resolved", "wont_fix"] as const;
const severities = ["all", "critical", "high", "medium", "low"] as const;

const humanize = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());

export function FeedbackFilters({
  params,
  selectedStatus,
  selectedRemediationStatus,
  selectedSeverity,
  selectedCategory,
  categories,
}: {
  params: URLSearchParams;
  selectedStatus: string;
  selectedRemediationStatus: string;
  selectedSeverity: string;
  selectedCategory: string;
  categories: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <div className="space-y-3 rounded-md border bg-card/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Remediation</span>
        {remediationStatuses.map((status) => (
          <button key={status} type="button" onClick={() => setFilter("remediationStatus", status)}>
            <Badge variant={selectedRemediationStatus === status ? "secondary" : "outline"}>{humanize(status)}</Badge>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</span>
        {statuses.map((status) => (
          <button key={status} type="button" onClick={() => setFilter("status", status)}>
            <Badge variant={selectedStatus === status ? "secondary" : "outline"}>{humanize(status)}</Badge>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Severity</span>
        {severities.map((severity) => (
          <button key={severity} type="button" onClick={() => setFilter("severity", severity)}>
            <Badge variant={selectedSeverity === severity ? "secondary" : "outline"}>{humanize(severity)}</Badge>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Category</span>
        <button type="button" onClick={() => setFilter("category", "all")}>
          <Badge variant={selectedCategory === "all" ? "secondary" : "outline"}>All</Badge>
        </button>
        {categories.map((category) => (
          <button key={category} type="button" onClick={() => setFilter("category", category)}>
            <Badge variant={selectedCategory === category ? "secondary" : "outline"}>{category}</Badge>
          </button>
        ))}
      </div>
    </div>
  );
}
