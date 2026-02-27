export type CouncilModelPolicy = {
  voter: string;
  synthesizer: string;
};

const OPENAI_COUNCIL_MODEL = "gpt-4o";

const DEFAULT_POLICY: CouncilModelPolicy = {
  voter: OPENAI_COUNCIL_MODEL,
  synthesizer: OPENAI_COUNCIL_MODEL,
};

const normalizeCouncilModel = (value: unknown): string => {
  if (typeof value !== "string") return OPENAI_COUNCIL_MODEL;
  const normalized = value.trim().toLowerCase();
  return normalized === OPENAI_COUNCIL_MODEL ? OPENAI_COUNCIL_MODEL : OPENAI_COUNCIL_MODEL;
};

export function resolveCouncilModelPolicy(raw: unknown): CouncilModelPolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_POLICY;
  }

  const policy = raw as Record<string, unknown>;

  return {
    voter: normalizeCouncilModel(policy.voter),
    synthesizer: normalizeCouncilModel(policy.synthesizer),
  };
}
