import { Prisma } from "@prisma/client";

export const OPENCLAW_AGENT_PREFIXES = ["Monitor", "Huragok", "Oracle", "Librarian", "Researcher"] as const;

type AgentRecord = {
  id: string;
  name: string;
  role: string;
};

type AssignmentSource = {
  agentId?: string | null;
  agentName?: string | null;
  role?: string | null;
  label?: string | null;
  jobType?: string | null;
  summary?: string | null;
  metadata?: Prisma.JsonValue;
  payload?: Prisma.JsonValue;
};

const asObject = (value: Prisma.JsonValue | null | undefined): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const normalize = (value: string) => value.trim().toLowerCase();
const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const stringFromUnknown = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const extractPrefixAgent = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const match = value.match(/^\s*([A-Za-z][A-Za-z0-9_-]{1,30})\s*:/);
  if (!match?.[1]) return null;
  return match[1];
};

const extractAgentToken = (value: string | null | undefined): string | null => {
  if (!value) return null;

  const normalized = value.trim();
  if (!normalized) return null;

  const knownPrefix = OPENCLAW_AGENT_PREFIXES.find((prefix) =>
    normalized.toLowerCase().startsWith(prefix.toLowerCase())
  );
  if (knownPrefix) return knownPrefix;

  const token = normalized.split(/[:\s_\-]+/).find(Boolean);
  return token?.trim() || null;
};

const gatherAssignmentCandidates = (source: AssignmentSource): string[] => {
  const out: string[] = [];
  const push = (value: unknown) => {
    const str = stringFromUnknown(value);
    if (str) out.push(str);
  };

  push(source.agentName);
  push(source.role);

  const metadata = asObject(source.metadata);
  const payload = asObject(source.payload);

  const preferredKeys = [
    "assigned_to",
    "assignedTo",
    "agent",
    "agentName",
    "role",
    "childSessionKey",
    "requesterSessionKey",
  ];
  for (const key of preferredKeys) {
    push(metadata?.[key]);
    push(payload?.[key]);
  }

  const tokenFields = [
    stringFromUnknown(metadata?.assigned_to),
    stringFromUnknown(payload?.assigned_to),
    stringFromUnknown(metadata?.childSessionKey),
    stringFromUnknown(payload?.childSessionKey),
    source.label,
    source.jobType,
  ];

  for (const value of tokenFields) {
    const token = extractAgentToken(value);
    if (token) out.push(token);
  }

  const textFields = [source.label, source.jobType, source.summary, stringFromUnknown(metadata?.label), stringFromUnknown(payload?.label)];
  for (const value of textFields) {
    const prefix = extractPrefixAgent(value);
    if (prefix) out.push(prefix);
  }

  // Scan task text for known agent name mentions (e.g., "Spawn a Huragok to...")
  const taskText = stringFromUnknown(metadata?.task) ?? stringFromUnknown(payload?.task);
  if (taskText) {
    for (const prefix of OPENCLAW_AGENT_PREFIXES) {
      if (taskText.toLowerCase().includes(prefix.toLowerCase())) {
        out.push(prefix);
      }
    }
  }

  return [...new Set(out.map((v) => v.trim()).filter(Boolean))];
};

export const resolveAssignedAgentId = (
  source: AssignmentSource,
  agents: AgentRecord[]
): { agentId: string | null; matchedBy?: string; candidate?: string } => {
  if (source.agentId) return { agentId: source.agentId };

  const candidates = gatherAssignmentCandidates(source);
  if (candidates.length === 0) return { agentId: null };

  const byId = new Map(agents.map((agent) => [agent.id, agent.id]));
  const byName = new Map(agents.map((agent) => [normalize(agent.name), agent.id]));
  const bySlug = new Map(agents.map((agent) => [slugify(agent.name), agent.id]));
  const byRole = new Map(agents.map((agent) => [normalize(agent.role), agent.id]));

  for (const candidate of candidates) {
    if (byId.has(candidate)) return { agentId: byId.get(candidate) ?? null, matchedBy: "id", candidate };

    const normalized = normalize(candidate);
    const slug = slugify(candidate);

    if (byName.has(normalized)) {
      return { agentId: byName.get(normalized) ?? null, matchedBy: "name", candidate };
    }

    if (bySlug.has(slug)) {
      return { agentId: bySlug.get(slug) ?? null, matchedBy: "slug", candidate };
    }

    if (byRole.has(normalized)) {
      return { agentId: byRole.get(normalized) ?? null, matchedBy: "role", candidate };
    }

    const startsWithName = agents.find((agent) => {
      const name = normalize(agent.name);
      const role = normalize(agent.role);
      return normalized.startsWith(name) || normalized.startsWith(role);
    });
    if (startsWithName) {
      return { agentId: startsWithName.id, matchedBy: "prefix", candidate };
    }
  }

  return { agentId: null, candidate: candidates[0] };
};
