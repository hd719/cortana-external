"use client";

import { usePathname, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";

const statuses = ["all", "pending", "approved", "rejected", "expired"] as const;

export function ApprovalFilters({
  params,
  selectedStatus,
}: {
  params: URLSearchParams;
  selectedStatus: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const setStatus = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (!value || value === "all") next.delete("status");
    else next.set("status", value);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <div className="space-y-3 rounded-md border bg-card/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</span>
        {statuses.map((status) => (
          <button key={status} type="button" onClick={() => setStatus(status)}>
            <Badge variant={selectedStatus === status ? "secondary" : "outline"}>
              {status === "all" ? "All" : status.charAt(0).toUpperCase() + status.slice(1)}
            </Badge>
          </button>
        ))}
      </div>
    </div>
  );
}
