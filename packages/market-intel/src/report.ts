import type { MarketIntelReport } from "./types.js";

const COMPACT_WATCHLIST_LIMIT = 5;

export function formatCompactReport(report: MarketIntelReport): string {
  const lines: string[] = [];
  const visible = report.topMarkets.slice(0, 3);

  if (visible.length === 0) {
    lines.push("Polymarket: unavailable or no high-signal markets cleared the filter");
  } else {
    lines.push(
      `Polymarket: ${visible
        .map((market) => `${market.displayTitle} ${fmtPct(market.probability)}${fmtDelta(market.change24h, "24h")}`)
        .join("; ")}`,
    );
  }

  lines.push(`Overlay: ${report.overlay.summary} — ${report.overlay.reason}`);
  lines.push(
    `Posture: ${titleCase(report.summary.conviction)} | ${formatAggressionDial(report.summary.aggressionDial)} | ${report.summary.divergence.summary}`,
  );
  lines.push(`Watchlist: ${formatCompactFocus(report)}`);

  if (report.warnings.length > 0) {
    lines.push(`Notes: ${report.warnings.join(" | ")}`);
  }

  return lines.join("\n");
}

export function formatVerboseReport(report: MarketIntelReport): string {
  const lines: string[] = [];
  lines.push("Polymarket Macro Snapshot");

  if (report.topMarkets.length === 0) {
    lines.push("- No markets cleared the current quality and relevance thresholds.");
  } else {
    for (const market of report.topMarkets) {
      lines.push(
        `- ${market.displayTitle}: ${fmtPct(market.probability)}${fmtDelta(market.change1h, "1h")}${fmtDelta(market.change4h, "4h")}${fmtDelta(market.change24h, "24h")} [${market.quality.tier}]${market.displayTitle !== market.title ? ` | source: ${market.title}` : ""}`,
      );
    }
  }

  lines.push("");
  lines.push("Interpretation");
  lines.push(`- ${report.overlay.summary}: ${report.overlay.reason}`);
  lines.push(
    `- Posture: ${titleCase(report.summary.conviction)} | ${formatAggressionDial(report.summary.aggressionDial)} | ${report.summary.divergence.summary}`,
  );
  lines.push(`- Divergence: ${report.summary.divergence.reason}`);
  for (const market of report.topMarkets.slice(0, 3)) {
    lines.push(
      `- ${market.theme}: ${market.impact.sectorImplications.join("; ")} [${market.signal.severity}, ${market.signal.persistence.state}]`,
    );
  }

  lines.push("");
  lines.push("Focus Routing");
  lines.push(
    `- Sectors first: ${report.summary.focusSectors.length > 0 ? report.summary.focusSectors.join(", ") : "No sector routing surfaced."}`,
  );
  lines.push(
    `- Crypto focus: ${report.summary.cryptoFocus.length > 0 ? report.summary.cryptoFocus.join(", ") : "No crypto-specific routing surfaced."}`,
  );

  lines.push("");
  lines.push("Watchlist Buckets");
  lines.push(
    `- Stocks: ${formatEntries(report.watchlistBuckets.stocks)}`,
  );
  lines.push(
    `- Crypto proxies: ${formatEntries(report.watchlistBuckets.cryptoProxies)}`,
  );
  lines.push(`- Crypto: ${formatEntries(report.watchlistBuckets.crypto)}`);
  lines.push(`- Funds/ETFs: ${formatEntries(report.watchlistBuckets.funds)}`);

  lines.push("");
  lines.push("Why Now");
  for (const market of report.topMarkets.slice(0, 3)) {
    lines.push(
      `- ${market.displayTitle}: ${fmtPct(market.probability)}${fmtDelta(market.change1h, "1h")}${fmtDelta(market.change4h, "4h")}${fmtDelta(market.change24h, "24h")} | ${market.signal.direction} | ${market.signal.severity} | ${market.signal.persistence.state}`,
    );
  }

  lines.push("");
  lines.push("Watchlist");
  lines.push(`- ${report.watchlist.length > 0 ? report.watchlist.join(", ") : "No watchlist names surfaced."}`);

  if (report.suppressedMarkets.length > 0) {
    lines.push("");
    lines.push("Suppressed Markets");
    for (const market of report.suppressedMarkets.slice(0, 5)) {
      lines.push(`- ${market.title}: ${market.reason}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }

  return lines.join("\n");
}

export function toJsonReport(report: MarketIntelReport): string {
  return JSON.stringify(report, null, 2);
}

function fmtPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function fmtDelta(value: number | null, label: string): string {
  if (value == null) return "";
  const points = Math.round(value * 100);
  const sign = points > 0 ? "+" : "";
  return ` (${sign}${points} pts/${label})`;
}

function formatWatchlistLine(symbols: string[], limit: number): string {
  if (symbols.length === 0) return "No event-sensitive names surfaced";
  if (symbols.length <= limit) return symbols.join(", ");
  return `${symbols.slice(0, limit).join(", ")} (+${symbols.length - limit} more)`;
}

function formatCompactFocus(report: MarketIntelReport): string {
  const buckets = [
    report.watchlistBuckets.stocks.map((entry) => entry.symbol),
    report.watchlistBuckets.cryptoProxies.map((entry) => entry.symbol),
    report.watchlistBuckets.crypto.map((entry) => entry.symbol),
    report.watchlistBuckets.funds.map((entry) => entry.symbol),
  ];
  const flattened = buckets.flat();
  return formatWatchlistLine(flattened, COMPACT_WATCHLIST_LIMIT);
}

function formatEntries(entries: MarketIntelReport["watchlistBuckets"]["stocks"]): string {
  if (entries.length === 0) return "none";
  return entries
    .map((entry) => `${entry.symbol} (${entry.severity}, ${entry.persistence})`)
    .join(", ");
}

function formatAggressionDial(value: MarketIntelReport["summary"]["aggressionDial"]): string {
  switch (value) {
    case "lean_more_aggressive":
      return "lean more aggressive";
    case "lean_more_selective":
      return "lean more selective";
    case "no_change":
      return "no change";
  }
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}
