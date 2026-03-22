import fs from "node:fs";
import path from "node:path";

import type { AppLogger } from "../lib/logger.js";
import type { MarketDataUniverse } from "./types.js";
import { extractUniverseSymbols, readJsonFile } from "./universe-utils.js";

export interface UniverseAuditEntry {
  refreshedAt: string;
  source: string;
  symbolCount: number;
  sourceLadder: string[];
}

interface UniverseManagerOptions {
  cacheDir: string;
  sourceLadder: string[];
  remoteJsonUrl: string;
  localJsonPath: string | null;
  seedPath: string;
  logger: AppLogger;
  fetchJson: <T>(url: string, init?: RequestInit) => Promise<T>;
}

interface UniverseSeedResult {
  symbols: string[];
  source: string;
}

export class UniverseArtifactManager {
  constructor(private readonly options: UniverseManagerOptions) {}

  async loadOrRefreshArtifact(forceRefresh: boolean): Promise<MarketDataUniverse> {
    const artifactPath = path.join(this.options.cacheDir, "base-universe.json");
    if (!forceRefresh) {
      const cached = readJsonFile<MarketDataUniverse>(artifactPath);
      const cachedAgeSeconds = cached?.updatedAt ? secondsSince(cached.updatedAt) : null;
      if (cached?.updatedAt && cachedAgeSeconds != null && cachedAgeSeconds < 24 * 3600) {
        return cached;
      }
    }

    const seeded = await this.resolveUniverseSeed();
    const payload: MarketDataUniverse = {
      symbols: seeded.symbols,
      source: seeded.source,
      updatedAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, JSON.stringify(payload, null, 2));
    this.appendAudit({
      refreshedAt: payload.updatedAt ?? new Date().toISOString(),
      source: payload.source,
      symbolCount: payload.symbols.length,
      sourceLadder: this.options.sourceLadder,
    });
    return payload;
  }

  readAudit(limit: number): UniverseAuditEntry[] {
    try {
      const auditPath = path.join(this.options.cacheDir, "base-universe-audit.jsonl");
      const lines = fs
        .readFileSync(auditPath, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-limit);
      return lines.map((line) => JSON.parse(line) as UniverseAuditEntry).reverse();
    } catch {
      return [];
    }
  }

  private appendAudit(entry: UniverseAuditEntry): void {
    try {
      const auditPath = path.join(this.options.cacheDir, "base-universe-audit.jsonl");
      fs.mkdirSync(path.dirname(auditPath), { recursive: true });
      fs.appendFileSync(auditPath, `${JSON.stringify(entry)}\n`);
    } catch (error) {
      this.options.logger.error("Unable to append universe audit entry", error);
    }
  }

  private async resolveUniverseSeed(): Promise<UniverseSeedResult> {
    const errors: string[] = [];
    for (const source of this.options.sourceLadder) {
      try {
        if (source === "remote_json") {
          return { symbols: await this.seedUniverseFromRemoteJson(), source: "remote_json" };
        }
        if (source === "local_json") {
          return { symbols: await this.seedUniverseFromLocalJson(), source: "local_json" };
        }
        if (source === "python_seed") {
          return { symbols: await this.seedUniverseFromPython(), source: "static_python_seed" };
        }
      } catch (error) {
        const summary = error instanceof Error ? error.message : String(error);
        this.options.logger.error(`Universe seed source ${source} failed`, error);
        errors.push(`${source}: ${summary}`);
      }
    }
    throw new Error(`Unable to resolve universe seed (${errors.join("; ")})`);
  }

  private async seedUniverseFromPython(): Promise<string[]> {
    const raw = await fs.promises.readFile(this.options.seedPath, "utf8");
    const start = raw.indexOf("SP500_TICKERS = [");
    if (start < 0) {
      throw new Error(`Unable to locate SP500_TICKERS in ${this.options.seedPath}`);
    }
    const end = raw.indexOf("]\n\n# Growth", start);
    const block = raw.slice(start, end > start ? end : undefined);
    const matches = [...block.matchAll(/"([A-Z0-9.\-^]+)"/g)].map((match) => match[1].replaceAll(".", "-"));
    return [...new Set(matches)];
  }

  private async seedUniverseFromRemoteJson(): Promise<string[]> {
    if (!this.options.remoteJsonUrl) {
      throw new Error("MARKET_DATA_UNIVERSE_REMOTE_JSON_URL is not configured");
    }
    const payload = await this.options.fetchJson<unknown>(this.options.remoteJsonUrl, {
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0",
      },
    });
    return extractUniverseSymbols(payload);
  }

  private async seedUniverseFromLocalJson(): Promise<string[]> {
    if (!this.options.localJsonPath) {
      throw new Error("MARKET_DATA_UNIVERSE_LOCAL_JSON_PATH is not configured");
    }
    const raw = await fs.promises.readFile(this.options.localJsonPath, "utf8");
    return extractUniverseSymbols(JSON.parse(raw) as unknown);
  }
}

function secondsSince(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.max(Math.round((Date.now() - parsed) / 1000), 0);
}
