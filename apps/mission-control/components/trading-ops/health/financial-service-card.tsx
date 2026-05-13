import { Badge } from "@/components/ui/badge";
import type { FinancialServiceHealthRow } from "@/lib/trading-ops-contract";
import { formatOperatorTimestamp } from "@/lib/format-utils";
import { badgeVariantForServiceHealth } from "@/lib/trading-ops/badge-variants";
import { Metric } from "../shared";

export function FinancialServiceCard({ row }: { row: FinancialServiceHealthRow }) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/20 p-3 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{row.label}</p>
          <p className="text-muted-foreground">{row.summary}</p>
        </div>
        <Badge variant={badgeVariantForServiceHealth(row.state)} className="text-[10px]">
          {row.badgeText ?? row.state}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Metric label="Detail" value={row.detail} />
        <Metric label="Updated" value={row.updatedAt ? formatOperatorTimestamp(row.updatedAt) : "—"} />
      </div>
      <p className="mt-2 truncate text-[10px] text-muted-foreground">Source: {row.source}</p>
    </div>
  );
}
