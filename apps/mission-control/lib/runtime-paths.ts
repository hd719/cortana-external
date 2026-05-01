import fs from "node:fs";
import path from "node:path";

const DEFAULT_CORTANA_SOURCE_REPO = "/Users/hd/Developer/cortana";
const DEFAULT_BACKTESTER_REPO = "/Users/hd/Developer/cortana-external/backtester";

function readEnvPath(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

export function getCortanaSourceRepo(): string {
  return readEnvPath("CORTANA_SOURCE_REPO") ?? DEFAULT_CORTANA_SOURCE_REPO;
}

export function getBacktesterRepoPath(): string {
  const explicit = readEnvPath("BACKTESTER_REPO_PATH");
  if (explicit) return explicit;

  const candidates = [
    path.resolve(process.cwd(), "backtester"),
    path.resolve(process.cwd(), "..", "..", "backtester"),
    DEFAULT_BACKTESTER_REPO,
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return DEFAULT_BACKTESTER_REPO;
}

export function getExternalResearchPath(): string {
  return readEnvPath("EXTERNAL_RESEARCH_PATH") ?? path.join(getRepoRoot(), "research");
}

export function getDocsPath(): string {
  return readEnvPath("DOCS_PATH") ?? path.join(getCortanaSourceRepo(), "docs");
}

export function getResearchPath(): string {
  return readEnvPath("RESEARCH_PATH") ?? path.join(getCortanaSourceRepo(), "research");
}

export function getKnowledgePath(): string {
  return readEnvPath("KNOWLEDGE_PATH") ?? path.join(getCortanaSourceRepo(), "knowledge");
}

export function getCorticalLoopPath(): string {
  return readEnvPath("CORTICAL_LOOP_PATH") ?? path.join(getCortanaSourceRepo(), "cortical-loop");
}

export function getHooksPath(): string {
  return readEnvPath("HOOKS_PATH") ?? path.join(getCortanaSourceRepo(), "hooks");
}

export function getImmuneSystemPath(): string {
  return readEnvPath("IMMUNE_SYSTEM_PATH") ?? path.join(getCortanaSourceRepo(), "immune-system");
}

export function getProprioceptionPath(): string {
  return readEnvPath("PROPRIOCEPTION_PATH") ?? path.join(getCortanaSourceRepo(), "proprioception");
}

export function getSaePath(): string {
  return readEnvPath("SAE_PATH") ?? path.join(getCortanaSourceRepo(), "sae");
}

export function getAgentProfilesPath(): string {
  return readEnvPath("AGENT_PROFILES_PATH") ?? path.join(getCortanaSourceRepo(), "config", "agent-profiles.json");
}

export function getAgentModelsPath(): string {
  return readEnvPath("AGENT_MODELS_PATH") ?? path.join(getCortanaSourceRepo(), "config", "agent-models.json");
}

export function getHeartbeatStatePath(): string {
  const explicit = readEnvPath("HEARTBEAT_STATE_PATH");
  if (explicit) return explicit;

  const homeDir = process.env.HOME?.trim() || "/Users/hd";
  const runtimeHeartbeatPath = path.join(homeDir, ".openclaw", "memory", "heartbeat-state.json");
  const repoHeartbeatPath = path.join(getCortanaSourceRepo(), "memory", "heartbeat-state.json");

  if (fs.existsSync(runtimeHeartbeatPath)) return runtimeHeartbeatPath;
  if (fs.existsSync(repoHeartbeatPath)) return repoHeartbeatPath;

  return runtimeHeartbeatPath;
}

export function getHeartbeatRuntimeSessionPath(): string {
  const explicit = readEnvPath("HEARTBEAT_RUNTIME_SESSION_FILE");
  if (explicit) return explicit;

  const homeDir = process.env.HOME?.trim() || "/Users/hd";
  return path.join(homeDir, ".openclaw", "agents", "main", "sessions", "sessions.json");
}

export function getHeartbeatRuntimeSessionKey(): string {
  return readEnvPath("HEARTBEAT_RUNTIME_SESSION_KEY") ?? "agent:main:main";
}

export function getTelegramUsageHandlerPath(): string {
  return readEnvPath("TELEGRAM_USAGE_HANDLER_PATH") ?? path.join(getCortanaSourceRepo(), "skills", "telegram-usage", "handler.ts");
}

function getRepoRoot(): string {
  return path.resolve(process.cwd(), "..", "..");
}
