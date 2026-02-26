"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ApprovalRequest } from "@/lib/approvals";

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

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const riskBadgeClass = (risk: string) => {
  if (risk === "p0") return "destructive" as const;
  if (risk === "p1") return "warning" as const;
  if (risk === "p2") return "info" as const;
  return "secondary" as const;
};

export function ApprovalCard({ approval }: { approval: ApprovalRequest }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [loadingAction, setLoadingAction] = useState<"approve" | "reject" | "approve_edited" | null>(null);
  const [reason, setReason] = useState("");
  const [events, setEvents] = useState(approval.events || []);

  useEffect(() => {
    if (!expanded) return;
    let alive = true;

    const load = async () => {
      const response = await fetch(`/api/approvals/${approval.id}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as ApprovalRequest;
      if (!alive) return;
      setEvents(payload.events || []);
    };

    load();
    return () => {
      alive = false;
    };
  }, [approval.id, expanded]);

  const truncatedRationale = useMemo(() => {
    if (!approval.rationale) return "No rationale provided.";
    if (approval.rationale.length <= 220) return approval.rationale;
    return `${approval.rationale.slice(0, 220)}…`;
  }, [approval.rationale]);

  const takeAction = async (action: "approve" | "reject" | "approve_edited") => {
    try {
      setLoadingAction(action);
      await fetch(`/api/approvals/${approval.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          actor: "mission-control-ui",
          decision: reason ? { reason } : undefined,
        }),
      });
      setReason("");
      router.refresh();
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="cursor-pointer pb-2" onClick={() => setExpanded((prev) => !prev)}>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Badge variant={riskBadgeClass(approval.riskLevel)}>{approval.riskLevel.toUpperCase()}</Badge>
          <span className="font-semibold">{approval.actionType}</span>
          <span className="text-xs font-normal text-muted-foreground">{approval.agentId}</span>
          <Badge variant="outline">{approval.status}</Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">{truncatedRationale}</p>
        <p className="text-xs text-muted-foreground">{toRelativeTime(approval.createdAt)}</p>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Proposal</p>
            <pre className="mt-1 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
              <code>{JSON.stringify(approval.proposal, null, 2)}</code>
            </pre>
          </div>

          {approval.diff && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Diff</p>
              <pre className="mt-1 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
                <code>{JSON.stringify(approval.diff, null, 2)}</code>
              </pre>
            </div>
          )}

          <div className="space-y-2">
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Optional reason for audit trail"
            />
            <div className="flex flex-wrap gap-2">
              <Button disabled={!!loadingAction} onClick={() => takeAction("approve")}>Approve</Button>
              <Button disabled={!!loadingAction} variant="destructive" onClick={() => takeAction("reject")}>
                Reject
              </Button>
              <Button disabled={!!loadingAction} variant="outline" onClick={() => takeAction("approve_edited")}>
                Approve Edited
              </Button>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Audit events</p>
            {events.length > 0 ? (
              <div className="mt-2 space-y-2">
                {events.map((event) => (
                  <div key={event.id} className="rounded border bg-card/60 p-2 text-xs">
                    <p className="font-medium">{event.eventType}</p>
                    <p className="text-muted-foreground">{event.actor || "system"} · {toRelativeTime(event.createdAt)}</p>
                    {Object.keys(event.payload).length > 0 && (
                      <pre className="mt-1 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
                        <code>{JSON.stringify(event.payload, null, 2)}</code>
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No events yet.</p>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
