import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DecisionFilters } from "@/lib/decision-traces";

type Facets = {
  actionTypes: string[];
  triggerTypes: string[];
  outcomes: string[];
};

const ranges = [6, 24, 48, 168];

const buildHref = (params: URLSearchParams, key: string, value?: string) => {
  const next = new URLSearchParams(params.toString());
  if (!value || value === "all") next.delete(key);
  else next.set(key, value);
  const query = next.toString();
  return query ? `/decisions?${query}` : "/decisions";
};

export function DecisionFiltersBar({
  params,
  filters,
  facets,
}: {
  params: URLSearchParams;
  filters: DecisionFilters;
  facets: Facets;
}) {
  const selectedRange = String(filters.rangeHours ?? 48);
  const selectedOutcome = filters.outcome ?? "all";

  return (
    <div className="space-y-3 rounded-md border bg-card/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Range</span>
        {ranges.map((hours: any) => (
          <Link key={hours} href={buildHref(params, "rangeHours", String(hours))}>
            <Badge variant={selectedRange === String(hours) ? "secondary" : "outline"}>
              {hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`}
            </Badge>
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Trigger</span>
        <Link href={buildHref(params, "triggerType", "all")}>
          <Badge variant={!filters.triggerType ? "secondary" : "outline"}>All</Badge>
        </Link>
        {facets.triggerTypes.map((value: any) => (
          <Link key={value} href={buildHref(params, "triggerType", value)}>
            <Badge variant={filters.triggerType === value ? "secondary" : "outline"}>{value}</Badge>
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Action</span>
        <Link href={buildHref(params, "actionType", "all")}>
          <Badge variant={!filters.actionType ? "secondary" : "outline"}>All</Badge>
        </Link>
        {facets.actionTypes.map((value: any) => (
          <Link key={value} href={buildHref(params, "actionType", value)}>
            <Badge variant={filters.actionType === value ? "secondary" : "outline"}>{value}</Badge>
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Outcome</span>
        {["all", "success", "fail", ...facets.outcomes.filter((o: any) => !["success", "fail"].includes(o))].map((value: any) => (
          <Link key={value} href={buildHref(params, "outcome", value)}>
            <Badge variant={selectedOutcome === value ? "secondary" : "outline"}>{value}</Badge>
          </Link>
        ))}
      </div>
    </div>
  );
}
