import type { MarketIntelLogger } from "./types.js";

export function createConsoleLogger(enabled = true): MarketIntelLogger {
  if (!enabled) {
    return {
      debug() {},
      info() {},
      warn() {},
      error() {},
    };
  }

  const write = (level: string, message: string, context?: Record<string, unknown>) => {
    const payload = {
      ts: new Date().toISOString(),
      level,
      message,
      ...(context ? { context } : {}),
    };
    const line = JSON.stringify(payload);
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  };

  return {
    debug(message, context) {
      write("debug", message, context);
    },
    info(message, context) {
      write("info", message, context);
    },
    warn(message, context) {
      write("warn", message, context);
    },
    error(message, context) {
      write("error", message, context);
    },
  };
}
