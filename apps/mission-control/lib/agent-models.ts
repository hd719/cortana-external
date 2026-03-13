import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { getAgentModelsPath } from "@/lib/runtime-paths";

type OpenClawModel = {
  key: string;
  name: string;
  available: boolean;
};

// Cache for the OpenClaw models list (refreshed per build/restart, not per request)
let modelsCache: OpenClawModel[] | null = null;

function getOpenClawModels(): OpenClawModel[] {
  if (modelsCache) return modelsCache;

  try {
    const raw = execSync("openclaw models list --json", {
      encoding: "utf8",
      timeout: 5000,
    });
    const parsed = JSON.parse(raw) as { models?: OpenClawModel[] };
    modelsCache = parsed.models || [];
    return modelsCache;
  } catch {
    return [];
  }
}

export function getAgentModelMap(): Record<string, string> {
  try {
    const agentModelsPath = getAgentModelsPath();
    if (!existsSync(agentModelsPath)) return {};
    return JSON.parse(readFileSync(agentModelsPath, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Returns the friendly display name for an agent's model.
 * Reads agent→model key from config/agent-models.json,
 * then resolves the human name from `openclaw models list --json`.
 */
export function getAgentModelDisplay(
  agentName: string,
  dbModel?: string | null
): { key: string | null; displayName: string | null } {
  const map = getAgentModelMap();
  const key = map[agentName] || dbModel || null;
  if (!key) return { key: null, displayName: null };

  const models = getOpenClawModels();
  const match = models.find((m) => m.key === key);
  const displayName = match?.name || key;

  return { key, displayName };
}
