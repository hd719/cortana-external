"use client";

import { useEffect, useMemo, useState } from "react";
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

const messageToneClass = (type: string) => {
  if (type === "proposal") return "border-blue-500/40 bg-blue-500/10";
  if (type === "critique") return "border-red-500/40 bg-red-500/10";
  if (type === "rebuttal") return "border-yellow-500/40 bg-yellow-500/10";
  if (type === "vote") return "border-green-500/40 bg-green-500/10";
  if (type === "judge_summary") return "border-purple-500/40 bg-purple-500/10";
  return "border-muted bg-muted/40";
};

export function CouncilSessionCard({ session }: { session: CouncilSession }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<CouncilSession>(session);

  useEffect(() => {
    if (!expanded) return;
    let alive = true;

    const load = async () => {
      const response = await fetch(`/api/council/${session.id}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as CouncilSession;
      if (!alive) return;
      setDetail(payload);
    };

    load();
    return () => {
      alive = false;
    };
  }, [expanded, session.id]);

  const voteTally = useMemo(() => {
    const tally = new Map<string, number>();
    for (const member of detail.members ?? []) {
      if (!member.vote) continue;
      tally.set(member.vote, (tally.get(member.vote) ?? 0) + 1);
    }
    const total = Array.from(tally.values()).reduce((sum, count) => sum + count, 0);
    return { total, entries: Array.from(tally.entries()) };
  }, [detail.members]);

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

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Members</p>
            {(detail.members?.length ?? 0) > 0 ? (
              <div className="mt-2 space-y-2">
                {(detail.members ?? []).map((member) => (
                  <div key={member.id} className="rounded border bg-card/60 p-2 text-xs">
                    <p className="font-medium">
                      {member.agentId} {member.role ? `(${member.role})` : ""} · weight {member.weight}
                    </p>
                    <p className="text-muted-foreground">
                      Vote: {member.vote ?? "pending"}
                      {typeof member.voteScore === "number" ? ` (${member.voteScore})` : ""}
                    </p>
                    {member.reasoning && <p className="mt-1 whitespace-pre-wrap">{member.reasoning}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">No members recorded.</p>
            )}
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Transcript</p>
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

          {session.status === "decided" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Final Decision</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
                  <code>{JSON.stringify(detail.finalDecision, null, 2)}</code>
                </pre>
                {detail.rationale && <p className="text-sm text-muted-foreground">{detail.rationale}</p>}
              </CardContent>
            </Card>
          )}

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vote tally</p>
            {voteTally.total > 0 ? (
              <div className="mt-2 space-y-2">
                {voteTally.entries.map(([vote, count]) => {
                  const pct = Math.round((count / voteTally.total) * 100);
                  return (
                    <div key={vote} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span>{vote}</span>
                        <span className="text-muted-foreground">{count} ({pct}%)</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded bg-muted">
                        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">No votes submitted yet.</p>
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
