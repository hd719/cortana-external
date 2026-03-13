import os from "node:os";
import path from "node:path";

const DEFAULT_CORTANA_SOURCE_REPO = "/Users/hd/Developer/cortana";

function readEnvPath(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

export function getCortanaSourceRepo(): string {
  return readEnvPath("CORTANA_SOURCE_REPO") ?? DEFAULT_CORTANA_SOURCE_REPO;
}

export function getDocsPath(): string {
  return readEnvPath("DOCS_PATH") ?? path.join(getCortanaSourceRepo(), "docs");
}

export function getAgentModelsPath(): string {
  return readEnvPath("AGENT_MODELS_PATH") ?? path.join(getCortanaSourceRepo(), "config", "agent-models.json");
}

export function getHeartbeatStatePath(): string {
  return readEnvPath("HEARTBEAT_STATE_PATH") ?? path.join(os.homedir(), ".openclaw", "memory", "heartbeat-state.json");
}

export function getTelegramUsageHandlerPath(): string {
  return readEnvPath("TELEGRAM_USAGE_HANDLER_PATH") ?? path.join(getCortanaSourceRepo(), "skills", "telegram-usage", "handler.ts");
}
