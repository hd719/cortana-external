import { appendCouncilMessage, finalizeDecision, getCouncilSessionById, submitVote } from "@/lib/council";

export type CouncilDeliberationJobResult = {
  sessionId: string;
  dispatched: number;
  skipped: boolean;
  reason?: string;
};

type CouncilVote = "approve" | "reject" | "abstain" | "amend";
type RoleKey = "huragok" | "oracle" | "researcher" | "librarian" | "generic";

type SynthesizerResponse = {
  outcome: "approve" | "reject" | "amend";
};

type OpenAIChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

type RoleValidationResult = {
  role: RoleKey;
  missingFields: string[];
};

const COUNCIL_MODEL = "gpt-4o";
const REQUIRED_PROVIDER = "openai";

const CONTRARIAN_INSTRUCTION = "Your job is to find the weakest point and argue against the proposal. Identify what breaks, what's missing, what everyone else is overlooking.";

const ROLE_PROMPTS: Record<RoleKey, string> = {
  huragok: [
    "You are Huragok, the systems engineer.",
    "MANDATORY CHECKLIST:",
    "- Name specific technical risks (no generic language).",
    "- Name explicit latency and scale concerns.",
    "- Name concrete dependency conflicts and integration friction points.",
    "- Give one concrete build recommendation in a 'build it like X' style.",
    "- Do NOT use adjectives like 'robust', 'seamless', or 'comprehensive' unless you immediately define concrete measurable details.",
  ].join("\n"),
  oracle: [
    "You are Oracle, the strategist.",
    "MANDATORY CHECKLIST:",
    "- List exactly 3 specific risks.",
    "- List at least 2 second-order effects and explicitly name the mechanism causing each effect.",
    "- Name 1 catastrophic failure scenario.",
    "- Do NOT use the word 'asymmetric' unless you explicitly name what is asymmetric and why.",
  ].join("\n"),
  researcher: [
    "You are Researcher, the analyst.",
    "MANDATORY CHECKLIST:",
    "- Name specific benchmarks.",
    "- Cite sources or precedents explicitly.",
    "- Enumerate failure modes and include probabilities or likelihood ratings for each.",
  ].join("\n"),
  librarian: [
    "You are Librarian, the institutional knowledge steward.",
    "MANDATORY CHECKLIST:",
    "- Cite specific prior decisions.",
    "- Cite specific documentation and historical patterns.",
    "- Reference concrete examples, not abstractions.",
  ].join("\n"),
  generic: "You are a council member. Provide domain-specific analysis and cast one vote: approve, reject, abstain, or amend.",
};

const ROLE_FIELD_REQUIREMENTS: Record<RoleKey, string[]> = {
  huragok: ["role_output.tech_risks", "role_output.latency_scale_concerns", "role_output.dependency_conflicts", "role_output.build_recommendation"],
  oracle: ["role_output.specific_risks", "role_output.second_order_effects", "role_output.catastrophic_failure_scenario"],
  researcher: ["role_output.benchmarks", "role_output.sources", "role_output.failure_modes"],
  librarian: ["role_output.prior_decisions", "role_output.documentation_refs", "role_output.historical_patterns", "role_output.concrete_examples"],
  generic: [],
};

const ROLE_OUTPUT_SCHEMAS: Record<RoleKey, Record<string, unknown>> = {
  huragok: {
    type: "object",
    required: ["tech_risks", "latency_scale_concerns", "dependency_conflicts", "build_recommendation"],
    properties: {
      tech_risks: { type: "array", minItems: 1, items: { type: "string" } },
      latency_scale_concerns: { type: "array", minItems: 1, items: { type: "string" } },
      dependency_conflicts: { type: "array", minItems: 1, items: { type: "string" } },
      build_recommendation: { type: "string", minLength: 1 },
    },
  },
  oracle: {
    type: "object",
    required: ["specific_risks", "second_order_effects", "catastrophic_failure_scenario"],
    properties: {
      specific_risks: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
      second_order_effects: {
        type: "array",
        minItems: 2,
        items: {
          type: "object",
          required: ["effect", "mechanism"],
          properties: {
            effect: { type: "string" },
            mechanism: { type: "string" },
          },
        },
      },
      catastrophic_failure_scenario: { type: "string", minLength: 1 },
    },
  },
  researcher: {
    type: "object",
    required: ["benchmarks", "sources", "failure_modes"],
    properties: {
      benchmarks: { type: "array", minItems: 1, items: { type: "string" } },
      sources: { type: "array", minItems: 1, items: { type: "string" } },
      failure_modes: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["mode", "likelihood"],
          properties: {
            mode: { type: "string" },
            likelihood: { type: "string" },
          },
        },
      },
    },
  },
  librarian: {
    type: "object",
    required: ["prior_decisions", "documentation_refs", "historical_patterns", "concrete_examples"],
    properties: {
      prior_decisions: { type: "array", minItems: 1, items: { type: "string" } },
      documentation_refs: { type: "array", minItems: 1, items: { type: "string" } },
      historical_patterns: { type: "array", minItems: 1, items: { type: "string" } },
      concrete_examples: { type: "array", minItems: 1, items: { type: "string" } },
    },
  },
  generic: { type: "object", additionalProperties: true },
};

const normalizeVote = (vote: string): CouncilVote => {
  const normalized = vote.trim().toLowerCase();
  if (normalized === "approve" || normalized === "reject" || normalized === "abstain" || normalized === "amend") {
    return normalized;
  }
  return "abstain";
};

const clampConfidence = (value: unknown, fallback = 0.5): number => {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(1, Math.max(0, Number(value.toFixed(2))));
};

const normalizeRoleKey = (agentId: string, role: string | null): RoleKey => {
  const agentKey = agentId.trim().toLowerCase();
  if (agentKey.includes("huragok")) return "huragok";
  if (agentKey.includes("oracle") || agentKey.includes("strategist")) return "oracle";
  if (agentKey.includes("researcher") || agentKey.includes("analyst")) return "researcher";
  if (agentKey.includes("librarian")) return "librarian";

  const roleKey = (role || "").trim().toLowerCase();
  if (roleKey.includes("huragok") || roleKey.includes("engineer")) return "huragok";
  if (roleKey.includes("oracle") || roleKey.includes("strateg")) return "oracle";
  if (roleKey.includes("research") || roleKey.includes("analyst")) return "researcher";
  if (roleKey.includes("librarian") || roleKey.includes("knowledge")) return "librarian";

  return "generic";
};

const extractJsonObject = (text: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // continue to fallback parsing
  }

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    try {
      const parsed = JSON.parse(fencedMatch[1]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      // continue to brace extraction
    }
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  return null;
};

const hasStringArray = (value: unknown, minItems: number): boolean => Array.isArray(value)
  && value.length >= minItems
  && value.every((item) => typeof item === "string" && item.trim().length > 0);

const validateRoleOutput = (role: RoleKey, payload: Record<string, unknown>): RoleValidationResult => {
  const missingFields: string[] = [];
  const roleOutput = payload.role_output;

  if (role === "generic") {
    return { role, missingFields };
  }

  if (!roleOutput || typeof roleOutput !== "object" || Array.isArray(roleOutput)) {
    return { role, missingFields: ROLE_FIELD_REQUIREMENTS[role] };
  }

  const data = roleOutput as Record<string, unknown>;

  if (role === "huragok") {
    if (!hasStringArray(data.tech_risks, 1)) missingFields.push("role_output.tech_risks");
    if (!hasStringArray(data.latency_scale_concerns, 1)) missingFields.push("role_output.latency_scale_concerns");
    if (!hasStringArray(data.dependency_conflicts, 1)) missingFields.push("role_output.dependency_conflicts");
    if (typeof data.build_recommendation !== "string" || data.build_recommendation.trim().length === 0) {
      missingFields.push("role_output.build_recommendation");
    }
  }

  if (role === "oracle") {
    if (!hasStringArray(data.specific_risks, 3) || (Array.isArray(data.specific_risks) && data.specific_risks.length !== 3)) {
      missingFields.push("role_output.specific_risks");
    }
    const secondOrder = data.second_order_effects;
    const validSecondOrder = Array.isArray(secondOrder)
      && secondOrder.length >= 2
      && secondOrder.every((item) => item && typeof item === "object"
        && typeof (item as Record<string, unknown>).effect === "string"
        && typeof (item as Record<string, unknown>).mechanism === "string");
    if (!validSecondOrder) missingFields.push("role_output.second_order_effects");
    if (typeof data.catastrophic_failure_scenario !== "string" || data.catastrophic_failure_scenario.trim().length === 0) {
      missingFields.push("role_output.catastrophic_failure_scenario");
    }
  }

  if (role === "researcher") {
    if (!hasStringArray(data.benchmarks, 1)) missingFields.push("role_output.benchmarks");
    if (!hasStringArray(data.sources, 1)) missingFields.push("role_output.sources");
    const failureModes = data.failure_modes;
    const validFailureModes = Array.isArray(failureModes)
      && failureModes.length > 0
      && failureModes.every((item) => item && typeof item === "object"
        && typeof (item as Record<string, unknown>).mode === "string"
        && typeof (item as Record<string, unknown>).likelihood === "string");
    if (!validFailureModes) missingFields.push("role_output.failure_modes");
  }

  if (role === "librarian") {
    if (!hasStringArray(data.prior_decisions, 1)) missingFields.push("role_output.prior_decisions");
    if (!hasStringArray(data.documentation_refs, 1)) missingFields.push("role_output.documentation_refs");
    if (!hasStringArray(data.historical_patterns, 1)) missingFields.push("role_output.historical_patterns");
    if (!hasStringArray(data.concrete_examples, 1)) missingFields.push("role_output.concrete_examples");
  }

  return { role, missingFields };
};

const ensureConfidenceJustification = (payload: Record<string, unknown>, confidence: number) => {
  const justification = typeof payload.justification === "string" ? payload.justification.trim() : "";
  if (!justification) {
    throw new Error("Missing required justification field");
  }

  const evidence = Array.isArray(payload.evidence)
    ? payload.evidence.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  if (confidence >= 0.8 && evidence.length < 2) {
    throw new Error("Confidence >= 0.8 requires at least 2 specific evidence points");
  }

  if (confidence >= 0.9) {
    if (evidence.length < 3) {
      throw new Error("Confidence >= 0.9 requires at least 3 specific evidence points");
    }

    const counterargument = typeof payload.counterargument_rejected === "string"
      ? payload.counterargument_rejected.trim()
      : "";

    if (!counterargument) {
      throw new Error("Confidence >= 0.9 requires a rejected counterargument");
    }
  }
};

const buildMemberPrompt = (args: {
  topic: string;
  objective: string | null;
  memberAgentId: string;
  role: string | null;
  weight: number;
  roleKey: RoleKey;
  contrarian: boolean;
}) => {
  const { topic, objective, memberAgentId, role, weight, roleKey, contrarian } = args;

  return [
    `Council topic: ${topic}`,
    `Council objective: ${objective ?? "No explicit objective provided."}`,
    `Council member: ${memberAgentId}`,
    `Council role: ${role ?? "unspecified"}`,
    `Council vote weight: ${weight}`,
    "",
    ROLE_PROMPTS[roleKey],
    "",
    contrarian ? CONTRARIAN_INSTRUCTION : "",
    "",
    "Return ONLY JSON using this structure:",
    "{",
    '  "vote": "approve|reject|abstain|amend",',
    '  "confidence": 0.0,',
    '  "analysis": "short paragraph",',
    '  "reasoning": "deeper rationale",',
    '  "justification": "why this confidence is warranted",',
    '  "evidence": ["specific evidence 1", "specific evidence 2"],',
    '  "counterargument_rejected": "required when confidence >= 0.9",',
    '  "role_output": { ... }',
    "}",
    "",
    "Role output JSON schema (follow strictly):",
    JSON.stringify(ROLE_OUTPUT_SCHEMAS[roleKey]),
    "",
    "Validation rules:",
    "- justification is always required.",
    "- confidence >= 0.8 requires at least 2 evidence items.",
    "- confidence >= 0.9 requires at least 3 evidence items plus counterargument_rejected.",
  ].filter(Boolean).join("\n");
};

const buildSynthesisPrompt = (args: {
  topic: string;
  objective: string | null;
  votes: Array<{
    agentId: string;
    role: string | null;
    weight: number;
    vote: string | null;
    confidence: number | null;
    reasoning: string | null;
    roleValidation: RoleValidationResult;
  }>;
  consensusSuspicious: boolean;
}) => {
  const { topic, objective, votes, consensusSuspicious } = args;
  return [
    "You are the council synthesizer.",
    "Compute a weighted synthesis from the member votes and reasoning.",
    "Validate each vote's completeness against the roleValidation payload. Explicitly list missing required fields.",
    consensusSuspicious
      ? "All agents voted the same way. This is suspicious. You MUST include a consensus_warning in your summary output."
      : "",
    "Return ONLY JSON with keys:",
    "- outcome: approve | reject | amend",
    "- confidence: number from 0.0 to 1.0",
    "- summary: short summary",
    "- rationale: final justification",
    "- schema_gaps: array of objects with { agentId, role, missingFields }",
    "- consensus_warning: required when all votes are identical",
    "",
    JSON.stringify({ topic, objective, votes, consensusSuspicious }),
  ].filter(Boolean).join("\n");
};

const callGatewayAgent = async (params: {
  sessionKey: string;
  idempotencyKey: string;
  message: string;
}) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Idempotency-Key": params.idempotencyKey,
      "X-Council-Session-Key": params.sessionKey,
    },
    body: JSON.stringify({
      model: COUNCIL_MODEL,
      messages: [
        {
          role: "user",
          content: params.message,
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI chat completion failed (${response.status}): ${errorText}`);
  }

  const parsed = (await response.json()) as OpenAIChatCompletionResponse;
  const text = parsed.choices?.[0]?.message?.content?.trim();

  if (!text) {
    throw new Error("OpenAI chat completion returned empty text payload");
  }

  return { text, provider: REQUIRED_PROVIDER, model: COUNCIL_MODEL };
};

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

export async function runCouncilDeliberationFanout(sessionId: string): Promise<CouncilDeliberationJobResult> {
  const session = await getCouncilSessionById(sessionId);
  if (!session) return { sessionId, dispatched: 0, skipped: true, reason: "session_not_found" };
  if (session.status !== "running") return { sessionId, dispatched: 0, skipped: true, reason: "session_not_running" };

  const pending = (session.members ?? []).filter((member) => !member.vote);
  if (pending.length === 0) {
    return { sessionId, dispatched: 0, skipped: true, reason: "no_pending_members" };
  }

  const allMembers = [...(session.members ?? [])].sort((a, b) => a.id - b.id);
  const fanoutCount = (session.messages ?? []).filter((message) => message.messageType === "fanout_dispatch").length;
  const deliberationIndex = Math.floor(fanoutCount / Math.max(allMembers.length, 1));
  const contrarianIndex = allMembers.length > 0
    ? (hashString(sessionId) + deliberationIndex) % allMembers.length
    : 0;
  const contrarianMemberId = allMembers[contrarianIndex]?.id;

  const nextTurn = Math.max(0, ...(session.messages ?? []).map((m) => m.turnNo)) + 1;

  await Promise.all(
    pending.map(async (member, index) => {
      const turnBase = nextTurn + (index * 3);
      const roleKey = normalizeRoleKey(member.agentId, member.role);
      const isContrarian = member.id === contrarianMemberId;
      const memberSessionKey = `agent:main:subagent:council:${sessionId}:${member.agentId.toLowerCase()}`;
      const idempotencyKey = `council-vote:${sessionId}:${member.id}`;

      await appendCouncilMessage({
        sessionId,
        turnNo: turnBase,
        speakerId: member.agentId,
        messageType: "fanout_dispatch",
        content: `Dispatched deliberation request to ${member.agentId} (${member.role ?? "general"}) via OpenClaw sub-agent`,
        metadata: {
          role: member.role,
          roleKey,
          roleSchema: ROLE_OUTPUT_SCHEMAS[roleKey],
          requiredFields: ROLE_FIELD_REQUIREMENTS[roleKey],
          contrarian: isContrarian,
          weight: member.weight,
          voterModel: COUNCIL_MODEL,
          voterProvider: REQUIRED_PROVIDER,
          sessionKey: memberSessionKey,
        },
      });

      try {
        const voterResponse = await callGatewayAgent({
          sessionKey: memberSessionKey,
          idempotencyKey,
          message: buildMemberPrompt({
            topic: session.topic,
            objective: session.objective,
            memberAgentId: member.agentId,
            role: member.role,
            weight: member.weight,
            roleKey,
            contrarian: isContrarian,
          }),
        });

        const parsed = extractJsonObject(voterResponse.text);
        if (!parsed) {
          throw new Error("Could not parse voter JSON response");
        }

        const vote = normalizeVote(String(parsed.vote ?? "abstain"));
        const confidence = clampConfidence(parsed.confidence, 0.5);
        ensureConfidenceJustification(parsed, confidence);

        const roleValidation = validateRoleOutput(roleKey, parsed);

        const canonicalVotePayload = {
          vote,
          confidence,
          analysis: typeof parsed.analysis === "string" ? parsed.analysis.trim() : "",
          reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : voterResponse.text,
          justification: typeof parsed.justification === "string" ? parsed.justification.trim() : "",
          evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
          counterargument_rejected: typeof parsed.counterargument_rejected === "string" ? parsed.counterargument_rejected.trim() : null,
          role_output: parsed.role_output,
          role_validation: roleValidation,
          contrarian: isContrarian,
        };

        await submitVote(sessionId, member.id, vote, JSON.stringify(canonicalVotePayload), confidence);

        await appendCouncilMessage({
          sessionId,
          turnNo: turnBase + 1,
          speakerId: member.agentId,
          messageType: "vote_submitted",
          content: `${member.agentId} voted ${vote} (confidence ${confidence}).`,
          metadata: {
            role: member.role,
            roleKey,
            roleValidation,
            contrarian: isContrarian,
            weight: member.weight,
            vote,
            confidence,
            model: voterResponse.model,
            provider: voterResponse.provider,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown voter error";

        await appendCouncilMessage({
          sessionId,
          turnNo: turnBase + 1,
          speakerId: member.agentId,
          messageType: "vote_error",
          content: `Failed to collect vote from ${member.agentId}: ${message}`,
          metadata: {
            role: member.role,
            roleKey,
            contrarian: isContrarian,
            weight: member.weight,
            model: COUNCIL_MODEL,
            provider: REQUIRED_PROVIDER,
          },
        });
      }
    }),
  );

  const refreshed = await getCouncilSessionById(sessionId);
  const votes = (refreshed?.members ?? []).filter((member) => member.vote);
  const totalMembers = refreshed?.members?.length ?? 0;

  if (refreshed && totalMembers > 0 && votes.length === totalMembers) {
    const synthTurn = Math.max(0, ...((refreshed.messages ?? []).map((m) => m.turnNo))) + 1;

    const normalizedVotes = votes.map((member) => normalizeVote(member.vote ?? "abstain"));
    const uniqueVotes = new Set(normalizedVotes);
    const consensusSuspicious = uniqueVotes.size === 1;

    await appendCouncilMessage({
      sessionId,
      turnNo: synthTurn,
      speakerId: "synthesizer",
      messageType: "synthesis_dispatch",
      content: `Dispatching final synthesis via OpenClaw sub-agent (${REQUIRED_PROVIDER}/${COUNCIL_MODEL})`,
      metadata: {
        synthesizerModel: COUNCIL_MODEL,
        synthesizerProvider: REQUIRED_PROVIDER,
        consensusSuspicious,
      },
    });

    try {
      const voteSummary = votes.map((member) => {
        const parsedReasoning = member.reasoning ? extractJsonObject(member.reasoning) : null;
        const roleKey = normalizeRoleKey(member.agentId, member.role);
        const roleValidation = parsedReasoning
          ? validateRoleOutput(roleKey, parsedReasoning)
          : { role: roleKey, missingFields: ROLE_FIELD_REQUIREMENTS[roleKey] };

        return {
          agentId: member.agentId,
          role: member.role,
          weight: member.weight,
          vote: member.vote,
          confidence: member.voteScore,
          reasoning: member.reasoning,
          roleValidation,
        };
      });

      const schemaGaps = voteSummary
        .filter((vote) => vote.roleValidation.missingFields.length > 0)
        .map((vote) => ({
          agentId: vote.agentId,
          role: vote.role,
          missingFields: vote.roleValidation.missingFields,
        }));

      const synthesisResponse = await callGatewayAgent({
        sessionKey: `agent:main:subagent:council:${sessionId}:synthesizer`,
        idempotencyKey: `council-synthesis:${sessionId}`,
        message: buildSynthesisPrompt({
          topic: refreshed.topic,
          objective: refreshed.objective,
          votes: voteSummary,
          consensusSuspicious,
        }),
      });

      const parsed = extractJsonObject(synthesisResponse.text);
      if (!parsed) {
        throw new Error("Could not parse synthesizer JSON response");
      }

      const outcome = ["approve", "reject", "amend"].includes(String(parsed.outcome).toLowerCase())
        ? String(parsed.outcome).toLowerCase() as SynthesizerResponse["outcome"]
        : "reject";
      const confidence = clampConfidence(parsed.confidence, 0.5);
      const summary = typeof parsed.summary === "string" ? parsed.summary : "";
      const rationale = typeof parsed.rationale === "string" && parsed.rationale.trim().length > 0
        ? parsed.rationale.trim()
        : synthesisResponse.text;

      const consensusWarning = consensusSuspicious
        ? (typeof parsed.consensus_warning === "string" && parsed.consensus_warning.trim().length > 0
          ? parsed.consensus_warning.trim()
          : "All council members cast the same vote. Treat this consensus as suspicious and re-check blind spots.")
        : null;

      const weightedTally = votes.reduce(
        (acc, member) => {
          const key = normalizeVote(member.vote ?? "abstain");
          acc[key] += member.weight;
          return acc;
        },
        { approve: 0, reject: 0, abstain: 0, amend: 0 },
      );

      await finalizeDecision(
        sessionId,
        {
          outcome,
          summary,
          consensusWarning,
          weightedTally,
          schemaGaps,
          votes: voteSummary,
          synthesizerModel: synthesisResponse.model,
          synthesizerProvider: synthesisResponse.provider,
        },
        confidence,
        rationale,
      );

      await appendCouncilMessage({
        sessionId,
        turnNo: synthTurn + 1,
        speakerId: "synthesizer",
        messageType: "synthesis_complete",
        content: `Final decision: ${outcome} (confidence ${confidence})`,
        metadata: {
          summary,
          consensusWarning,
          weightedTally,
          schemaGaps,
          synthesizerModel: synthesisResponse.model,
          synthesizerProvider: synthesisResponse.provider,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown synthesis error";

      await appendCouncilMessage({
        sessionId,
        turnNo: synthTurn + 1,
        speakerId: "synthesizer",
        messageType: "synthesis_error",
        content: `Final synthesis failed: ${message}`,
        metadata: {
          synthesizerModel: COUNCIL_MODEL,
          synthesizerProvider: REQUIRED_PROVIDER,
        },
      });
    }
  }

  return { sessionId, dispatched: pending.length, skipped: false };
}
