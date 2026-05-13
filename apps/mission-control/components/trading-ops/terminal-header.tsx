import type { LiveQuoteRow, TradingOpsDashboardData, TradingOpsLiveData } from "@/lib/trading-ops-contract";
import { formatRelativeAge } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { useAnimatedValue, useFlashClass } from "./animated-quote";

const HEADER_TICKER_SYMBOLS = ["NASDAQ", "DOW", "SPY", "QQQ", "IWM"];

export function TerminalHeader({
  data,
  liveData,
}: {
  data: TradingOpsDashboardData;
  liveData?: TradingOpsLiveData | null;
}) {
  const tickerRows = (liveData?.tape.rows ?? [])
    .filter((row) => HEADER_TICKER_SYMBOLS.includes(row.symbol))
    .sort(
      (a, b) =>
        HEADER_TICKER_SYMBOLS.indexOf(a.symbol) - HEADER_TICKER_SYMBOLS.indexOf(b.symbol),
    );

  const streamerConnected = liveData?.streamer.connected ?? false;
  const isAfterHours = liveData?.meta.isAfterHours ?? null;

  return (
    <section className="rounded-lg border border-border/70 bg-card/80 font-mono">
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 md:px-4">
        <div className="flex items-center gap-2 md:gap-3">
          <h1 className="text-xs font-bold uppercase tracking-wider md:text-sm">Cortana Trading Ops</h1>
          <LivePulse streamerConnected={streamerConnected} isAfterHours={isAfterHours} />
          {liveData ? <SessionPill isAfterHours={isAfterHours ?? false} /> : null}
        </div>

        {tickerRows.length > 0 ? (
          <div className="order-3 flex w-full items-center divide-x divide-border/50 overflow-x-auto md:order-none md:w-auto">
            {tickerRows.map((row) => (
              <MiniTicker key={`${row.symbol}-${row.sourceSymbol}`} row={row} />
            ))}
          </div>
        ) : null}

        <span className="text-[10px] text-muted-foreground">{formatRelativeAge(data.generatedAt)}</span>
      </div>
    </section>
  );
}

function LivePulse({
  streamerConnected,
  isAfterHours,
}: {
  streamerConnected: boolean;
  isAfterHours: boolean | null;
}) {
  const tone = !streamerConnected
    ? { dot: "bg-red-500", ping: "bg-red-500/70", label: "off" }
    : isAfterHours
      ? { dot: "bg-amber-500", ping: "bg-amber-500/70", label: "live" }
      : { dot: "bg-emerald-500", ping: "bg-emerald-500/70", label: "live" };

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-0.5">
      <span className="relative inline-flex h-2 w-2">
        <span className={cn("absolute inset-0 inline-flex animate-ping rounded-full", tone.ping)} />
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", tone.dot)} />
      </span>
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{tone.label}</span>
    </span>
  );
}

function SessionPill({ isAfterHours }: { isAfterHours: boolean }) {
  const cls = isAfterHours
    ? "border-amber-400/60 bg-amber-500/10 text-amber-600 dark:text-amber-400"
    : "border-emerald-400/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  return (
    <span className={cn("rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest", cls)}>
      {isAfterHours ? "After hours" : "Market open"}
    </span>
  );
}

function MiniTicker({ row }: { row: LiveQuoteRow }) {
  const animatedPrice = useAnimatedValue(row.price);
  const animatedChange = useAnimatedValue(row.changePercent);
  const flash = useFlashClass(row.price);

  const changeTone =
    row.changePercent == null || row.state !== "ok"
      ? "text-muted-foreground"
      : row.changePercent > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : row.changePercent < 0
          ? "text-red-600 dark:text-red-400"
          : "text-muted-foreground";

  const arrow =
    row.changePercent == null || row.changePercent === 0
      ? "·"
      : row.changePercent > 0
        ? "▲"
        : "▼";

  return (
    <div
      className={cn(
        "flex shrink-0 items-baseline gap-1.5 px-3 py-0.5 transition-colors duration-700",
        flash,
      )}
    >
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{row.label}</span>
      <span className="font-mono text-sm font-semibold tabular-nums leading-tight">
        {formatPrice(animatedPrice)}
      </span>
      <span className={cn("font-mono text-[11px] tabular-nums leading-tight", changeTone)}>
        {arrow} {formatChangePct(animatedChange)}
      </span>
    </div>
  );
}

function formatPrice(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatChangePct(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}
