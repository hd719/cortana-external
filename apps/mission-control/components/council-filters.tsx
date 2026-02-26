"use client";

import { usePathname, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const statuses = ["all", "running", "decided", "cancelled"] as const;
const modes = ["all", "majority", "weighted", "debate_judge"] as const;

export function CouncilFilters({
  params,
  selectedStatus,
  selectedMode,
}: {
  params: URLSearchParams;
  selectedStatus: string;
  selectedMode: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const pushWith = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (!value || value === "all") next.delete(key);
      else next.set(key, value);
    });
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <div className="space-y-3 rounded-md border bg-card/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</span>
        {statuses.map((status) => (
          <button key={status} type="button" onClick={() => pushWith({ status })}>
            <Badge variant={selectedStatus === status ? "secondary" : "outline"}>
              {status === "all" ? "All" : status.charAt(0).toUpperCase() + status.slice(1)}
            </Badge>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mode</span>
        <Select value={selectedMode || "all"} onValueChange={(value) => pushWith({ mode: value })}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All modes" />
          </SelectTrigger>
          <SelectContent>
            {modes.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {mode === "all"
                  ? "All"
                  : mode === "debate_judge"
                    ? "Debate+Judge"
                    : mode.charAt(0).toUpperCase() + mode.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => router.refresh()}>
          Refresh
        </Button>
      </div>
    </div>
  );
}
