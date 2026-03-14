import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");

export const DEFAULT_REGISTRY_PATH = path.join(
  repoRoot,
  "config/market-intel/polymarket-registry.json",
);
export const DEFAULT_HISTORY_DIR = path.join(
  repoRoot,
  "var/market-intel/polymarket/history",
);
export const DEFAULT_LATEST_PATH = path.join(
  repoRoot,
  "var/market-intel/polymarket/latest.json",
);
export const DEFAULT_REGIME_PATH = path.join(
  repoRoot,
  ".cache/market_regime_snapshot_SPY.json",
);
export const DEFAULT_ARTIFACT_DIR = path.join(
  repoRoot,
  "var/market-intel/polymarket",
);
export const DEFAULT_REPORT_JSON_PATH = path.join(
  DEFAULT_ARTIFACT_DIR,
  "latest-report.json",
);
export const DEFAULT_COMPACT_REPORT_PATH = path.join(
  DEFAULT_ARTIFACT_DIR,
  "latest-compact.txt",
);
export const DEFAULT_WATCHLIST_JSON_PATH = path.join(
  repoRoot,
  "backtester/data/polymarket_watchlist.json",
);

export function resolveRuntimePaths(overrides: {
  registryPath?: string;
  latestPath?: string;
  historyDir?: string;
  regimePath?: string | null;
}) {
  return {
    registryPath: overrides.registryPath ?? DEFAULT_REGISTRY_PATH,
    latestPath: overrides.latestPath ?? DEFAULT_LATEST_PATH,
    historyDir: overrides.historyDir ?? DEFAULT_HISTORY_DIR,
    regimePath: overrides.regimePath ?? DEFAULT_REGIME_PATH,
  };
}
