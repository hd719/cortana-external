import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { appendCouncilMessage, finalizeDecision, getCouncilSessionById, submitVote } from "@/lib/council";

export type CouncilDeliberationJobResult = {
  sessionId: string;
  dispatched: number;
  skipped: boolean;
  reason?: string;
};

type CouncilVote = "approve" | "reject" | "abstain" | "amend";

type SynthesizerResponse = {
  outcome: "approve" | "reject" | "amend";
};

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const COUNCIL_MODEL = "gpt-4o";

const ROLE_INSTRUCTIONS: Record<string, string> = {
  oracle: "You are Oracle, the strategist (weight 1.5). Focus on long-term strategic implications, asymmetric risk/reward, and alignment with mission pillars: Time, Health, Wealth, and Career.",
  strategist: "You are Oracle, the strategist (weight 1.5). Focus on long-term strategic implications, asymmetric risk/reward, and alignment with mission pillars: Time, Health, Wealth, and Career.",
  researcher: "You are Researcher, the analyst (weight 1.2). Focus on evidence quality, assumptions, feasibility, prior art, and failure modes.",
  analyst: "You are Researcher, the analyst (weight 1.2). Focus on evidence quality, assumptions, feasibility, prior art, and failure modes.",
  huragok: "You are Huragok, the engineer (weight 1.0). Focus on technical feasibility, implementation complexity, architecture impact, reliability tradeoffs, and maintenance burden.",
  engineer: "You are Huragok, the engineer (weight 1.0). Focus on technical feasibility, implementation complexity, architecture impact, reliability tradeoffs, and maintenance burden.",
  monitor: "You are Monitor, operations (weight 0.8). Focus on operational impact, observability, reliability, run-cost, incident risk, and on-call burden.",
  operations: "You are Monitor, operations (weight 0.8). Focus on operational impact, observability, reliability, run-cost, incident risk, and on-call burden.",
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

const getRoleInstruction = (agentId: string, role: string | null): string => {
  const agentKey = agentId.trim().toLowerCase();
  if (ROLE_INSTRUCTIONS[agentKey]) return ROLE_INSTRUCTIONS[agentKey];

  const roleKey = (role || "").trim().toLowerCase();
  if (ROLE_INSTRUCTIONS[roleKey]) return ROLE_INSTRUCTIONS[roleKey];

  return "You are a council member. Provide domain-specific analysis and cast one vote: approve, reject, abstain, or amend.";
};

const getOpenAIApiKey = async (): Promise<string> => {
  const envKey = process.env.OPENAI_API_KEY
    || process.env.OPENAI_APIKEY
    || process.env.OPENAI_KEY;

  if (envKey && envKey.trim().length > 0) {
    return envKey.trim();
  }

  const modelsPath = join(homedir(), ".openclaw", "agents", "main", "agent", "models.json");
  const raw = await readFile(modelsPath, "utf8");
  const parsed = JSON.parse(raw) as {
    providers?: { openai?: { apiKey?: string } };
  };

  const fileKey = parsed.providers?.openai?.apiKey;
  if (!fileKey || fileKey.trim().length === 0) {
    throw new Error("OpenAI API key not configured in env or ~/.openclaw/agents/main/agent/models.json");
  }

  return fileKey.trim();
};

const callOpenAI = async (apiKey: string, messages: Array<{ role: "system" | "user"; content: string }>) => {
  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: COUNCIL_MODEL,
      temperature: 0.3,
      messages,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${body}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI API returned empty completion content");
  }

  return content;
};

export async function runCouncilDeliberationFanout(sessionId: string): Promise<CouncilDeliberationJobResult> {
  const session = await getCouncilSessionById(sessionId);
  if (!session) return { sessionId, dispatched: 0, skipped: true, reason: "session_not_found" };
  if (session.status !== "running") return { sessionId, dispatched: 0, skipped: true, reason: "session_not_running" };

  const pending = (session.members ?? []).filter((member) => !member.vote);
  if (pending.length === 0) {
    return { sessionId, dispatched: 0, skipped: true, reason: "no_pending_members" };
  }

  const apiKey = await getOpenAIApiKey();
  const nextTurn = Math.max(0, ...(session.messages ?? []).map((m) => m.turnNo)) + 1;

  await Promise.all(
    pending.map(async (member, index) => {
      const turnBase = nextTurn + (index * 3);
      const roleInstruction = getRoleInstruction(member.agentId, member.role);

      await appendCouncilMessage({
        sessionId,
        turnNo: turnBase,
        speakerId: member.agentId,
        messageType: "fanout_dispatch",
        content: `Dispatched deliberation request to ${member.agentId} (${member.role ?? "general"}) via ${COUNCIL_MODEL}`,
        metadata: {
          role: member.role,
          weight: member.weight,
          voterModel: COUNCIL_MODEL,
        },
      });

      try {
        const voterContent = await callOpenAI(apiKey, [
          {
            role: "system",
            content: `${roleInstruction}\n\nReturn ONLY JSON with keys: analysis (string), vote (approve|reject|abstain|amend), confidence (0.0-1.0), reasoning (2-4 paragraphs).`,
          },
          {
            role: "user",
            content: [
              `Council topic: ${session.topic}`,
              `Council objective: ${session.objective ?? "No explicit objective provided."}`,
              `Member: ${member.agentId}`,
              `Role: ${member.role ?? "unspecified"}`,
              `Weight: ${member.weight}`,
              "Provide your domain analysis and vote.",
            ].join("\n"),
          },
        ]);

        const parsed = extractJsonObject(voterContent);
        if (!parsed) {
          throw new Error("Could not parse voter JSON response");
        }

        const vote = normalizeVote(String(parsed.vote ?? "abstain"));
        const confidence = clampConfidence(parsed.confidence, 0.5);
        const analysis = typeof parsed.analysis === "string" ? parsed.analysis.trim() : "";
        const reasoningBody = typeof parsed.reasoning === "string" && parsed.reasoning.trim().length > 0
          ? parsed.reasoning.trim()
          : voterContent;
        const reasoning = analysis ? `${analysis}\n\n${reasoningBody}` : reasoningBody;

        await submitVote(sessionId, member.id, vote, reasoning, confidence);

        await appendCouncilMessage({
          sessionId,
          turnNo: turnBase + 1,
          speakerId: member.agentId,
          messageType: "vote_submitted",
          content: `${member.agentId} voted ${vote} (confidence ${confidence}).`,
          metadata: {
            role: member.role,
            weight: member.weight,
            vote,
            confidence,
            model: COUNCIL_MODEL,
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
            weight: member.weight,
            model: COUNCIL_MODEL,
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

    await appendCouncilMessage({
      sessionId,
      turnNo: synthTurn,
      speakerId: "synthesizer",
      messageType: "synthesis_dispatch",
      content: `Dispatching final synthesis via ${COUNCIL_MODEL}`,
      metadata: {
        synthesizerModel: COUNCIL_MODEL,
      },
    });

    try {
      const voteSummary = votes.map((member) => ({
        agentId: member.agentId,
        role: member.role,
        weight: member.weight,
        vote: member.vote,
        confidence: member.voteScore,
        reasoning: member.reasoning,
      }));

      const synthesisContent = await callOpenAI(apiKey, [
        {
          role: "system",
          content: "You are the council synthesizer. Weigh each member vote by provided weight, summarize key agreements/disagreements, and output ONLY JSON with keys: outcome (approve|reject|amend), confidence (0.0-1.0), summary (string), rationale (string).",
        },
        {
          role: "user",
          content: JSON.stringify({
            topic: refreshed.topic,
            objective: refreshed.objective,
            votes: voteSummary,
          }),
        },
      ]);

      const parsed = extractJsonObject(synthesisContent);
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
        : synthesisContent;

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
          weightedTally,
          votes: voteSummary,
          synthesizerModel: COUNCIL_MODEL,
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
          weightedTally,
          synthesizerModel: COUNCIL_MODEL,
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
        },
      });
    }
  }

  return { sessionId, dispatched: pending.length, skipped: false };
}
