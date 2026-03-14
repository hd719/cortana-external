#!/usr/bin/env node
import { assessArtifactHealth, formatArtifactHealthReport } from "./health.js";
import { createConsoleLogger } from "./logger.js";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const logger = createConsoleLogger(true);
  const report = await assessArtifactHealth({
    reportJsonPath: args.reportJsonPath,
    compactReportPath: args.compactReportPath,
    watchlistJsonPath: args.watchlistJsonPath,
    maxAgeHours: args.maxAgeHours,
    minTopMarkets: args.minTopMarkets,
    minWatchlistCount: args.minWatchlistCount,
  });

  if (args.output === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatArtifactHealthReport(report));
  }

  if (!report.ok) {
    logger.error("market_intel_watchdog_failed", {
      failures: report.failures,
    });
    process.exit(1);
  }
}

function parseArgs(argv: string[]) {
  const parsed: {
    reportJsonPath?: string;
    compactReportPath?: string;
    watchlistJsonPath?: string;
    maxAgeHours: number;
    minTopMarkets: number;
    minWatchlistCount: number;
    output: "text" | "json";
  } = {
    maxAgeHours: 8,
    minTopMarkets: 1,
    minWatchlistCount: 1,
    output: "text",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--report-json":
        parsed.reportJsonPath = next;
        index += 1;
        break;
      case "--compact":
        parsed.compactReportPath = next;
        index += 1;
        break;
      case "--watchlist":
        parsed.watchlistJsonPath = next;
        index += 1;
        break;
      case "--max-age-hours":
        parsed.maxAgeHours = Number(next);
        index += 1;
        break;
      case "--min-top-markets":
        parsed.minTopMarkets = Number(next);
        index += 1;
        break;
      case "--min-watchlist-count":
        parsed.minWatchlistCount = Number(next);
        index += 1;
        break;
      case "--output":
        parsed.output = next === "json" ? "json" : "text";
        index += 1;
        break;
      default:
        break;
    }
  }

  return parsed;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
