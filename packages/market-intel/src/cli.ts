#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { buildPolymarketIntelReport } from "./service.js";
import { formatCompactReport, formatVerboseReport, toJsonReport } from "./report.js";

type OutputMode = "compact" | "verbose" | "json";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildPolymarketIntelReport({
    registryPath: args.registryPath,
    historyDir: args.historyDir,
    latestPath: args.latestPath,
    regimeInput: args.regimeInput,
    maxMarkets: args.maxMarkets,
    persistHistory: args.persistHistory,
  });

  console.log(renderOutput(report, args.output));
}

export function parseArgs(argv: string[]) {
  const parsed: {
    output: OutputMode;
    registryPath?: string;
    historyDir?: string;
    latestPath?: string;
    regimeInput?: string;
    maxMarkets?: number;
    persistHistory: boolean;
  } = {
    output: "verbose",
    persistHistory: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--output":
        parsed.output = (next as OutputMode) ?? "verbose";
        index += 1;
        break;
      case "--registry":
        parsed.registryPath = next;
        index += 1;
        break;
      case "--history-dir":
        parsed.historyDir = next;
        index += 1;
        break;
      case "--latest":
        parsed.latestPath = next;
        index += 1;
        break;
      case "--regime":
        parsed.regimeInput = next;
        index += 1;
        break;
      case "--max-markets":
        parsed.maxMarkets = Number(next);
        index += 1;
        break;
      case "--persist":
        parsed.persistHistory = true;
        break;
      case "--help":
        printHelp();
        process.exit(0);
      default:
        break;
    }
  }

  return parsed;
}

export function renderOutput(
  report: Awaited<ReturnType<typeof buildPolymarketIntelReport>>,
  output: OutputMode,
): string {
  return output === "json"
    ? toJsonReport(report)
    : output === "compact"
      ? formatCompactReport(report)
      : formatVerboseReport(report);
}

function printHelp() {
  console.log(`Usage: pnpm report --output <compact|verbose|json> [options]

Options:
  --registry <path>      Override registry JSON path
  --history-dir <path>   Override history directory
  --latest <path>        Override latest snapshot path
  --regime <path|json>   Override regime cache path or inline JSON
  --max-markets <n>      Limit visible markets
  --persist              Write latest/history snapshots after building report
`);
}

const isEntrypoint = process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
