import { cn } from "@/lib/utils";

export function RosterMetric({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border/50 bg-muted/20 px-2 py-1.5 transition-[background-color,border-color,box-shadow] duration-700",
        highlight && "border-amber-300/60 bg-amber-50/60 shadow-[0_0_0_1px_rgba(245,158,11,0.18)]",
      )}
    >
      <p className="terminal-metric-label">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-medium leading-tight">{value}</p>
    </div>
  );
}
