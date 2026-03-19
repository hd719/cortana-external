import type { AppLogger } from "../lib/logger.js";
import { ensureDataDir, loadLatestPayload, saveLatestPayload, appendToHistory } from "./store.js";
import { HealthTestPayloadSchema, HealthSyncPayloadSchema } from "./types.js";

export interface AppleHealthServiceOptions {
  token: string;
  dataDir: string;
  logger: AppLogger;
}

export class AppleHealthService {
  private readonly token: string;
  private readonly dataDir: string;
  private readonly logger: AppLogger;

  constructor(options: AppleHealthServiceOptions) {
    this.token = options.token;
    this.dataDir = options.dataDir;
    this.logger = options.logger;
  }

  validateToken(authHeader: string | undefined): boolean {
    if (!authHeader) return false;
    return authHeader === `Bearer ${this.token}`;
  }

  async handleTest(body: unknown): Promise<{ ok: true; receivedAt: string; stored: true }> {
    const parsed = HealthTestPayloadSchema.parse(body);
    await ensureDataDir(this.dataDir);
    await saveLatestPayload(this.dataDir, parsed);
    this.logger.printf("received health_test from device=%s", parsed.deviceId);
    return { ok: true, receivedAt: new Date().toISOString(), stored: true };
  }

  async handleSync(body: unknown): Promise<{ ok: true; receivedAt: string; stored: true }> {
    const parsed = HealthSyncPayloadSchema.parse(body);
    await ensureDataDir(this.dataDir);
    await saveLatestPayload(this.dataDir, parsed);
    await appendToHistory(this.dataDir, parsed);
    this.logger.printf("received health_sync from device=%s range=%s..%s", parsed.deviceId, parsed.range.start, parsed.range.end);
    return { ok: true, receivedAt: new Date().toISOString(), stored: true };
  }

  async getHealth(): Promise<Record<string, unknown>> {
    try {
      const latest = await loadLatestPayload<Record<string, unknown>>(this.dataDir);
      return {
        status: "healthy",
        lastSyncAt: latest.sentAt ?? null,
      };
    } catch {
      return {
        status: "inactive",
      };
    }
  }
}
