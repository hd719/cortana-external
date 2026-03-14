#!/usr/bin/env node
import { auditRegistryHealth, formatRegistryHealthReport } from "./health.js";
import { createConsoleLogger } from "./logger.js";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const logger = createConsoleLogger(true);
  const report = await auditRegistryHealth({
    registryPath: args.registryPath,
    logger,
  });

  if (args.output === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatRegistryHealthReport(report));
  }

  if (report.requiredBroken > 0 || report.fallbackOnly > args.maxFallbackOnly) {
    logger.error("market_intel_registry_audit_failed", {
      broken: report.broken,
      requiredBroken: report.requiredBroken,
      fallbackOnly: report.fallbackOnly,
      maxFallbackOnly: args.maxFallbackOnly,
    });
    process.exit(1);
  }
}

function parseArgs(argv: string[]) {
  const parsed: {
    registryPath?: string;
    output: "text" | "json";
    maxFallbackOnly: number;
  } = {
    output: "text",
    maxFallbackOnly: 2,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--registry":
        parsed.registryPath = next;
        index += 1;
        break;
      case "--output":
        parsed.output = next === "json" ? "json" : "text";
        index += 1;
        break;
      case "--max-fallback-only":
        parsed.maxFallbackOnly = Number(next);
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
