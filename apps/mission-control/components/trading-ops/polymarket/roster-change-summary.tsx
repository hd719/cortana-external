import { Badge } from "@/components/ui/badge";
import { formatOperatorTimestamp } from "@/lib/format-utils";
import type { usePolymarketRosterState } from "./use-polymarket-roster-state";

export function RosterChangeSummary({
  state,
}: {
  state: ReturnType<typeof usePolymarketRosterState>;
}) {
  if (!state.badgeLabel && !state.updatedAt) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {state.badgeLabel ? (
        <Badge
          variant="outline"
          className="border-amber-300/70 bg-amber-100/80 text-[10px] text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-200"
        >
          {state.badgeLabel}
        </Badge>
      ) : null}
      {state.updatedAt ? (
        <p className="text-amber-800/90 dark:text-amber-200/90">
          Roster updated {formatOperatorTimestamp(state.updatedAt)}.
        </p>
      ) : null}
    </div>
  );
}
