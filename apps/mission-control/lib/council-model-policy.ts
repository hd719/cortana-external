export type CouncilModelPolicy = {
  voter: string;
  synthesizer: string;
};

const DEFAULT_POLICY: CouncilModelPolicy = {
  voter: "gpt-4o",
  synthesizer: "gpt-4o",
};

export function resolveCouncilModelPolicy(raw: unknown): CouncilModelPolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_POLICY;
  }

  const policy = raw as Record<string, unknown>;
  const voter = typeof policy.voter === "string" && policy.voter.trim().length > 0
    ? policy.voter
    : DEFAULT_POLICY.voter;
  const synthesizer = typeof policy.synthesizer === "string" && policy.synthesizer.trim().length > 0
    ? policy.synthesizer
    : DEFAULT_POLICY.synthesizer;

  return { voter, synthesizer };
}
