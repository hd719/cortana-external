#!/usr/bin/env node

import { writeIntegrationArtifacts } from "./artifacts.js";
import { createConsoleLogger } from "./logger.js";
import {
  DEFAULT_ARTIFACT_DIR,
  DEFAULT_HISTORY_DIR,
  DEFAULT_LATEST_PATH,
  DEFAULT_WATCHLIST_JSON_PATH,
} from "./paths.js";
import { buildPolymarketIntelReport } from "./service.js";

async function main() {
  const logger = createConsoleLogger(true);
  const report = await buildPolymarketIntelReport({
    persistHistory: true,
    historyDir: DEFAULT_HISTORY_DIR,
    latestPath: DEFAULT_LATEST_PATH,
    historyMaxSnapshots: 240,
    historyMaxAgeDays: 45,
    logger,
  });

  await writeIntegrationArtifacts(report, {
    artifactDir: DEFAULT_ARTIFACT_DIR,
    watchlistExportPath: DEFAULT_WATCHLIST_JSON_PATH,
  });

  logger.info("market_intel_integration_artifacts_written", {
    artifactDir: DEFAULT_ARTIFACT_DIR,
    watchlistExportPath: DEFAULT_WATCHLIST_JSON_PATH,
    topMarkets: report.topMarkets.length,
    watchlist: report.watchlist.length,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
