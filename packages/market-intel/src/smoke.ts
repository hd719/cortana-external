#!/usr/bin/env node
import { buildPolymarketIntelReport } from "./service.js";
import { createConsoleLogger } from "./logger.js";

async function main() {
  const logger = createConsoleLogger(true);
  const report = await buildPolymarketIntelReport({
    maxMarkets: 4,
    logger,
  });

  const failures: string[] = [];
  if (report.topMarkets.length === 0) {
    failures.push("no top markets were produced");
  }
  if (report.warnings.length > 2) {
    failures.push(`too many warnings: ${report.warnings.length}`);
  }
  if (report.topMarkets.some((market) => market.quality.tier === "ignore")) {
    failures.push("ignore-tier market leaked into topMarkets");
  }

  if (failures.length > 0) {
    logger.error("market_intel_smoke_failed", { failures });
    process.exit(1);
  }

  logger.info("market_intel_smoke_ok", {
    topMarkets: report.topMarkets.map((market) => ({
      title: market.displayTitle,
      probability: market.probability,
      tier: market.quality.tier,
    })),
    warnings: report.warnings,
    overlay: report.overlay.alignment,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
