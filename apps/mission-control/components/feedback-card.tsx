"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FeedbackItem } from "@/lib/feedback";

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

const severityVariant = (severity: string) => {
  if (severity === "critical") return "destructive" as const;
  if (severity === "high") return "warning" as const;
  if (severity === "medium") return "info" as const;
  return "secondary" as const;
};

export function FeedbackCard({ feedback }: { feedback: FeedbackItem }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [actionType, setActionType] = useState("patch");
  const [actionRef, setActionRef] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"planned" | "applied" | "verified" | "failed">("planned");
  const [submitting, setSubmitting] = useState(false);
  const [actions, setActions] = useState(feedback.actions || []);

  useEffect(() => {
    if (!expanded) return;
    let alive = true;

    const load = async () => {
      const response = await fetch(`/api/feedback/${feedback.id}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as FeedbackItem;
      if (!alive) return;
      setActions(payload.actions || []);
    };

    load();
    return () => {
      alive = false;
    };
  }, [expanded, feedback.id]);

  const detailsText = useMemo(() => JSON.stringify(feedback.details || {}, null, 2), [feedback.details]);

  const addAction = async () => {
    try {
      setSubmitting(true);
      await fetch(`/api/feedback/${feedback.id}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionType, actionRef: actionRef || null, description: description || null, status }),
      });
      setDescription("");
      setActionRef("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="cursor-pointer pb-2" onClick={() => setExpanded((prev) => !prev)}>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Badge variant={severityVariant(feedback.severity)}>{feedback.severity.toUpperCase()}</Badge>
          <Badge variant="outline">{feedback.category}</Badge>
          <Badge variant="secondary">{feedback.source}</Badge>
          <Badge variant="outline">{feedback.status}</Badge>
        </CardTitle>
        <p className="text-sm text-foreground">{feedback.summary}</p>
        <p className="text-xs text-muted-foreground">{toRelativeTime(feedback.createdAt)}</p>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Details</p>
            <pre className="mt-1 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
              <code>{detailsText}</code>
            </pre>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actions</p>
            {actions.length > 0 ? (
              <div className="mt-2 space-y-2">
                {actions.map((action) => (
                  <div key={action.id} className="rounded border bg-card/60 p-2 text-xs">
                    <p className="font-medium">{action.actionType}</p>
                    <p className="text-muted-foreground">{action.status} · {toRelativeTime(action.createdAt)}</p>
                    {action.actionRef && <p className="text-muted-foreground">ref: {action.actionRef}</p>}
                    {action.description && <p className="text-muted-foreground">{action.description}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No remediation actions yet.</p>
            )}
          </div>

          <div className="space-y-2 rounded border p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Add action</p>
            <Input value={actionType} onChange={(event) => setActionType(event.target.value)} placeholder="Action type" />
            <Input value={actionRef} onChange={(event) => setActionRef(event.target.value)} placeholder="Action ref (optional)" />
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description (optional)" />
            <div className="flex flex-wrap gap-2">
              {(["planned", "applied", "verified", "failed"] as const).map((option) => (
                <button key={option} type="button" onClick={() => setStatus(option)}>
                  <Badge variant={status === option ? "secondary" : "outline"}>{option}</Badge>
                </button>
              ))}
            </div>
            <Button disabled={submitting || !actionType.trim()} onClick={addAction}>Add action</Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
