import { readFileSync, existsSync } from "node:fs";
import { getAgentModelsPath, getAgentProfilesPath } from "@/lib/runtime-paths";

const formatModelDisplayName = (key: string) => {
  const suffix = key.split("/").pop() ?? key;
  if (!suffix) return key;

  return suffix
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => {
      if (/^gpt-\d/i.test(part)) return part.toUpperCase();
      if (part.toLowerCase() === "gpt") return "GPT";
      if (/^\d+(\.\d+)*$/.test(part)) return part;
      if (part.toLowerCase() === "codex") return "Codex";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
};

/* ── agent roles (canonical definitions for display) ── */

const AGENT_ROLES: Record<string, { name: string; role: string; capabilities: string }> = {
  main: { name: "Cortana", role: "Command Deck", capabilities: "Triage, routing, synthesis, escalation" },
  monitor: { name: "Monitor", role: "Guardian", capabilities: "Health, cron delivery, drift, incidents" },
  arbiter: { name: "Arbiter", role: "Council Chair", capabilities: "Multi-agent deliberation, voting" },
  spartan: { name: "Spartan", role: "Fitness Coach", capabilities: "Whoop/Tonal analysis, coaching" },
  librarian: { name: "Librarian", role: "Knowledge Base", capabilities: "Docs, schema, information architecture" },
};

export type AgentProfile = {
  id: string;
  name: string;
  role: string;
  capabilities: string;
  model: string | null;
  modelDisplay: string | null;
};

export function getAgentProfiles(): AgentProfile[] {
  try {
    const profilesPath = getAgentProfilesPath();
    if (!existsSync(profilesPath)) return [];
    const raw = JSON.parse(readFileSync(profilesPath, "utf8")) as Array<{ id: string; model?: string }>;
    const modelMap = getAgentModelMap();

    return raw
      .filter((p) => !p.id.startsWith("cron-"))
      .map((p) => {
        const meta = AGENT_ROLES[p.id] ?? { name: p.id, role: "Agent", capabilities: "" };
        const modelKey = p.model ?? modelMap[meta.name] ?? null;
        return {
          id: p.id,
          name: meta.name,
          role: meta.role,
          capabilities: meta.capabilities,
          model: modelKey,
          modelDisplay: modelKey ? formatModelDisplayName(modelKey) : null,
        };
      });
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

  return { key, displayName: formatModelDisplayName(key) };
}
