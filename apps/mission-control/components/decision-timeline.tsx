import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DecisionTrace } from "@/lib/decision-traces";

const fmt = (value: string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

const confidenceLabel = (value: number | null) => {
  if (value === null || Number.isNaN(value)) return "n/a";
  return `${Math.round(value * 100)}%`;
};

const outcomeVariant = (value: string) => {
  const lower = value.toLowerCase();
  if (["success", "ok", "done", "completed"].includes(lower)) return "success" as const;
  if (["fail", "failed", "error", "timeout", "cancelled", "canceled"].includes(lower)) return "destructive" as const;
  return "outline" as const;
};

export function DecisionTimeline({ traces }: { traces: DecisionTrace[] }) {
  if (traces.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Decision timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No traces match current filters.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {traces.map((trace) => (
        <Card key={trace.id} className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <Badge variant="outline">{trace.actionType}</Badge>
              <Badge variant="secondary">trigger: {trace.triggerType}</Badge>
              <Badge variant="outline">confidence: {confidenceLabel(trace.confidence)}</Badge>
              <Badge variant={outcomeVariant(trace.outcome)}>{trace.outcome}</Badge>
            </CardTitle>
            <p className="break-all text-xs text-muted-foreground">
              {fmt(trace.createdAt)} · trace {trace.traceId}
              {trace.taskId ? ` · task #${trace.taskId}` : ""}
              {trace.runId ? ` · run ${trace.runId}` : ""}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {trace.reasoning && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Why this action</p>
                <p className="text-sm text-foreground">{trace.reasoning}</p>
              </div>
            )}

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Explainability inputs</p>
              {Object.keys(trace.dataInputs).length === 0 ? (
                <p className="text-sm text-muted-foreground">No input payload captured.</p>
              ) : (
                <pre className="mt-1 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
                  {JSON.stringify(trace.dataInputs, null, 2)}
                </pre>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Trigger linkage</p>
                {trace.triggerEvent ? (
                  <div className="text-sm text-muted-foreground">
                    <p>{trace.triggerEvent.eventType} · {trace.triggerEvent.source}</p>
                    <p>{trace.triggerEvent.message}</p>
                    <p className="text-xs">{fmt(trace.triggerEvent.timestamp)}</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No linked event row.</p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Metadata</p>
                {Object.keys(trace.metadata).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No metadata.</p>
                ) : (
                  <pre className="mt-1 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
                    {JSON.stringify(trace.metadata, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
