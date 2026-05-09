import type { ExternalServices } from "./app.js";
import type { AppLogger } from "./lib/logger.js";

interface LifecycleLoggers {
  startup: AppLogger;
  refresh: AppLogger;
  shutdown: AppLogger;
}

function withTimeout(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timeout),
  };
}

export class ExternalServiceLifecycleSupervisor {
  private maintenanceRunning = false;
  private maintenanceInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly services: ExternalServices,
    private readonly loggers: LifecycleLoggers,
  ) {}

  async startup(): Promise<void> {
    await this.runStep("market-data startup", () => this.services.marketData.startup());
    await this.runStep("whoop warmup", () => this.services.whoop.warmup());
    this.services.whoopWebhook?.processor.start();
    const tonalWarmup = withTimeout(20_000);
    try {
      await this.runStep("tonal warmup", () => this.services.tonal.warmup(tonalWarmup.signal));
    } finally {
      tonalWarmup.cancel();
    }
  }

  startMaintenance(intervalMs = 30 * 60 * 1000): NodeJS.Timeout {
    this.maintenanceInterval = setInterval(() => {
      void this.runMaintenanceOnce();
    }, intervalMs);
    return this.maintenanceInterval;
  }

  async runMaintenanceOnce(): Promise<void> {
    if (this.maintenanceRunning) {
      return;
    }
    this.maintenanceRunning = true;
    try {
      await this.refreshWhoop();
      await this.refreshTonal();
    } finally {
      this.maintenanceRunning = false;
    }
  }

  async shutdown(): Promise<void> {
    if (this.maintenanceInterval) {
      clearInterval(this.maintenanceInterval);
      this.maintenanceInterval = null;
    }
    await this.services.marketData.shutdown().catch((error) => {
      this.loggers.shutdown.error("market-data shutdown failed", error);
    });
    this.services.whoopWebhook?.processor.stop();
    await this.services.whoopWebhook?.store.close();
  }

  private async refreshWhoop(): Promise<void> {
    const timeout = withTimeout(20_000);
    try {
      await this.services.whoop.proactiveRefreshIfExpiring(60 * 60 * 1000);
      this.loggers.refresh.log("whoop proactive refresh check completed");
    } catch (error) {
      this.loggers.refresh.error("whoop proactive refresh failed", error);
    } finally {
      timeout.cancel();
    }
  }

  private async refreshTonal(): Promise<void> {
    const timeout = withTimeout(20_000);
    try {
      await this.services.tonal.proactiveRefreshIfExpiring(timeout.signal, 60 * 60 * 1000);
      this.loggers.refresh.log("tonal proactive refresh check completed");
    } catch (error) {
      this.loggers.refresh.error("tonal proactive refresh failed", error);
    } finally {
      timeout.cancel();
    }
  }

  private async runStep(label: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
      this.loggers.startup.log(`${label} ok`);
    } catch (error) {
      this.loggers.startup.error(`${label} failed`, error);
    }
  }
}
