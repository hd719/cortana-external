"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CouncilSession } from "@/lib/council";

const toRelativeTime = (iso: string | null) => {
  if (!iso) return "never";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";

  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const modeVariant = (mode: string) => {
  if (mode === "majority") return "info" as const;
  if (mode === "weighted") return "secondary" as const;
  if (mode === "debate_judge") return "warning" as const;
  return "outline" as const;
};

const statusVariant = (status: string) => {
  if (status === "running") return "success" as const;
  if (status === "decided") return "info" as const;
  if (status === "cancelled") return "secondary" as const;
  if (status === "timeout") return "destructive" as const;
  return "outline" as const;
};

const voteVariant = (vote?: string | null) => {
  const normalized = (vote ?? "").toLowerCase();
  if (normalized === "approve") return "success" as const;
  if (normalized === "reject") return "destructive" as const;
  if (normalized === "amend") return "warning" as const;
  if (normalized === "abstain") return "secondary" as const;
  return "outline" as const;
};

const normalizeVote = (vote?: string | null) => (vote ?? "").trim().toLowerCase();

const messageToneClass = (type: string) => {
  if (type === "proposal") return "border-blue-500/40 bg-blue-500/10";
  if (type === "critique") return "border-red-500/40 bg-red-500/10";
  if (type === "rebuttal") return "border-yellow-500/40 bg-yellow-500/10";
  if (type === "vote") return "border-green-500/40 bg-green-500/10";
  if (type === "judge_summary") return "border-purple-500/40 bg-purple-500/10";
  return "border-muted bg-muted/40";
};

const extractJsonObject = (text: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // fallback below
  }

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    try {
      const parsed = JSON.parse(fencedMatch[1]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      // fallback below
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

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
};

const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const toSentenceSummary = (value: string, maxSentences = 2) => {
  const clean = value.trim();
  if (!clean) return "No concise analysis provided.";
  const parts = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (parts.length <= maxSentences) return clean;
  return parts.slice(0, maxSentences).join(" ");
};

const summarizeDecision = (value: string) => {
  const clean = value.trim();
  if (!clean) return "No rationale provided.";
  const parts = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.slice(0, 3).join(" ");
};

const humanizeField = (field: string) => field.replace(/^role_output\./, "").replaceAll("_", " ");

const flattenEvidence = (roleOutput: Record<string, unknown>, parsed: Record<string, unknown>) => {
  const sourceCandidates = [
    ...asStringArray(roleOutput.sources),
    ...asStringArray(roleOutput.documentation_refs),
    ...asStringArray(roleOutput.benchmarks),
    ...asStringArray(parsed.evidence),
  ];

  const unique = Array.from(new Set(sourceCandidates.map((item) => item.trim()).filter(Boolean)));
  return unique.slice(0, 4);
};

export function CouncilSessionCard({ session }: { session: CouncilSession }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<CouncilSession>(session);
  const [openRawMembers, setOpenRawMembers] = useState<Record<number, boolean>>({});
  const [openFinalRaw, setOpenFinalRaw] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    let alive = true;
    let source: EventSource | null = null;

    const load = async () => {
      const response = await fetch(`/api/council/${session.id}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as CouncilSession;
      if (!alive) return;
      setDetail(payload);
    };

    const connect = () => {
      source = new EventSource(`/api/council/stream?sessionId=${session.id}`);
      source.addEventListener("update", (event) => {
        if (!alive) return;
        try {
          const parsed = JSON.parse((event as MessageEvent).data) as { data?: CouncilSession | null };
          if (parsed.data) setDetail(parsed.data);
        } catch {
          // no-op
        }
      });
      source.onerror = () => {
        source?.close();
        source = null;
      };
    };

    load();
    connect();

    return () => {
      alive = false;
      source?.close();
    };
  }, [expanded, session.id]);

  const voteTally = useMemo(() => {
    const tally = new Map<string, number>();
    for (const member of detail.members ?? []) {
      if (!member.vote) continue;
      const key = normalizeVote(member.vote);
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    const total = Array.from(tally.values()).reduce((sum, count) => sum + count, 0);
    return { total, entries: Array.from(tally.entries()).sort((a, b) => b[1] - a[1]) };
  }, [detail.members]);

  const finalDecision = useMemo(() => {
    const payload = detail.finalDecision ?? {};
    const outcome = asString(payload.outcome) || "pending";
    const summary = asString(payload.summary);
    const consensusWarning = asString(payload.consensusWarning);
    const weightedTally = payload.weightedTally && typeof payload.weightedTally === "object" && !Array.isArray(payload.weightedTally)
      ? (payload.weightedTally as Record<string, unknown>)
      : null;

    const schemaGapsRaw = Array.isArray(payload.schemaGaps) ? payload.schemaGaps : [];
    const schemaGapLines = schemaGapsRaw
      .map((gap) => {
        if (!gap || typeof gap !== "object" || Array.isArray(gap)) return null;
        const item = gap as Record<string, unknown>;
        const agentId = asString(item.agentId) || "unknown";
        const role = asString(item.role);
        const fields = asStringArray(item.missingFields).map(humanizeField);
        const roleLabel = role ? ` (${role})` : "";
        if (fields.length === 0) return `${agentId}${roleLabel}`;
        return `${agentId}${roleLabel}: ${fields.join(", ")}`;
      })
      .filter((line): line is string => Boolean(line));

    const voteChips = weightedTally
      ? Object.entries(weightedTally)
        .filter(([, value]) => typeof value === "number")
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([vote, value]) => `${value} ${vote}`)
      : voteTally.entries.map(([vote, count]) => `${count} ${vote}`);

    return {
      outcome,
      summary,
      consensusWarning,
      schemaGapLines,
      voteChips,
    };
  }, [detail.finalDecision, voteTally.entries]);

  const memberCards = useMemo(() => (detail.members ?? []).map((member) => {
    const parsed = member.reasoning ? extractJsonObject(member.reasoning) : null;
    const analysis = parsed ? asString(parsed.analysis) : "";
    const roleOutput = parsed && parsed.role_output && typeof parsed.role_output === "object" && !Array.isArray(parsed.role_output)
      ? (parsed.role_output as Record<string, unknown>)
      : {};

    const keyPoints = [
      ...asStringArray(roleOutput.tech_risks),
      ...asStringArray(roleOutput.specific_risks),
      ...asStringArray(roleOutput.failure_modes),
      ...asStringArray(roleOutput.second_order_effects),
      ...asStringArray(roleOutput.latency_scale_concerns),
      ...asStringArray(roleOutput.dependency_conflicts),
      ...asStringArray(roleOutput.catastrophic_failure_scenario),
      ...asStringArray(roleOutput.concrete_examples),
      ...asStringArray(roleOutput.historical_patterns),
    ];

    const buildRecommendation = asString(roleOutput.build_recommendation);
    const evidence = parsed ? flattenEvidence(roleOutput, parsed) : [];
    const contrarian = Boolean(parsed && parsed.contrarian === true);

    return {
      member,
      analysis: toSentenceSummary(analysis || member.reasoning || ""),
      keyPoints: buildRecommendation ? [buildRecommendation, ...keyPoints] : keyPoints,
      evidence,
      parsed,
      contrarian,
    };
  }), [detail.members]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="cursor-pointer pb-2" onClick={() => setExpanded((prev) => !prev)}>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span className="font-semibold">{session.topic}</span>
          <Badge variant={modeVariant(session.mode)}>{session.mode}</Badge>
          <Badge variant={statusVariant(session.status)}>{session.status}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {(detail.members?.length ?? 0)} members · created {toRelativeTime(session.createdAt)}
          {typeof detail.confidence === "number" && session.status === "decided"
            ? ` · confidence ${detail.confidence.toFixed(2)}`
            : ""}
        </p>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4">
          {detail.objective && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Objective</p>
              <p className="mt-1 text-sm">{detail.objective}</p>
            </div>
          )}

          {session.status === "decided" && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Final Decision</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={voteVariant(finalDecision.outcome)}>{finalDecision.outcome}</Badge>
                  {typeof detail.confidence === "number" && (
                    <Badge variant="outline">confidence {detail.confidence.toFixed(2)}</Badge>
                  )}
                </div>

                <p className="text-muted-foreground">{summarizeDecision(finalDecision.summary || detail.rationale || "")}</p>

                {finalDecision.voteChips.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vote tally</p>
                    <p className="text-sm">{finalDecision.voteChips.join(" · ")}</p>
                  </div>
                )}

                {finalDecision.consensusWarning && (
                  <div className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs">
                    <AlertTriangle className="mt-0.5 h-4 w-4 text-yellow-500" />
                    <p className="text-yellow-100">{finalDecision.consensusWarning}</p>
                  </div>
                )}

                {finalDecision.schemaGapLines.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Schema gaps</p>
                    <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                      {finalDecision.schemaGapLines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <Button variant="outline" size="sm" onClick={() => setOpenFinalRaw((prev) => !prev)}>
                    {openFinalRaw ? "Hide full details" : "Show full details"}
                  </Button>
                  {openFinalRaw && (
                    <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
                      <code>{JSON.stringify(detail.finalDecision, null, 2)}</code>
                    </pre>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Member votes</p>
            {memberCards.length > 0 ? (
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {memberCards.map(({ member, analysis, keyPoints, evidence, parsed, contrarian }) => (
                  <div key={member.id} className="rounded border bg-card/60 p-3 text-xs space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-sm">{member.agentId}</p>
                      {member.role && <Badge variant="outline">{member.role}</Badge>}
                      <Badge variant={voteVariant(member.vote)}>{member.vote ?? "pending"}</Badge>
                      {typeof member.voteScore === "number" && (
                        <Badge variant="secondary">{member.voteScore.toFixed(2)}</Badge>
                      )}
                      {contrarian && <Badge variant="destructive">🔴 Devil&apos;s Advocate</Badge>}
                    </div>

                    <p className="text-muted-foreground">{analysis}</p>

                    {keyPoints.length > 0 && (
                      <div>
                        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Key points</p>
                        <ul className="list-disc space-y-1 pl-4 text-xs">
                          {keyPoints.slice(0, 6).map((point) => (
                            <li key={point}>{point}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {evidence.length > 0 && (
                      <div>
                        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Evidence</p>
                        <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                          {evidence.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setOpenRawMembers((prev) => ({ ...prev, [member.id]: !prev[member.id] }))}
                      >
                        {openRawMembers[member.id] ? "Hide full details" : "Show full details"}
                      </Button>
                      {openRawMembers[member.id] && (
                        <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
                          <code>{JSON.stringify(parsed ?? member.reasoning ?? {}, null, 2)}</code>
                        </pre>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">No members recorded.</p>
            )}
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vote timeline</p>
            {(detail.messages?.length ?? 0) > 0 ? (
              <div className="mt-2 space-y-2">
                {(detail.messages ?? []).map((message) => (
                  <div key={message.id} className={`rounded border p-2 text-xs ${messageToneClass(message.messageType)}`}>
                    <p className="font-medium">
                      T{message.turnNo} · {message.speakerId} · {message.messageType}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{message.content}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">No transcript messages yet.</p>
            )}
          </div>

          <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>
            Collapse
          </Button>
        </CardContent>
      )}
    </Card>
  );
}
