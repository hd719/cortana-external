import { Activity, AlertTriangle, CheckCircle2, Clock3, ShieldAlert } from "lucide-react";
import { getAutonomyOpsSnapshot } from "@/lib/autonomy-ops";
import { listHumanRequiredActions, type HumanRequiredAction } from "@/lib/human-required-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const tone: Record<string, string> = {
  live: "border-emerald-500/40 bg-emerald-500/5 text-emerald-700",
  watch: "border-amber-500/40 bg-amber-500/5 text-amber-700",
  attention: "border-red-500/40 bg-red-500/5 text-red-700",
};

function TimeLabel({ iso }: { iso: string | null }) {
  if (!iso) return <span>unknown</span>;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return <span>unknown</span>;
  return <span>{parsed.toLocaleString()}</span>;
}

function ListBlock({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {items.length ? items.slice(0, 6).map((item) => (
          <div key={item} className="rounded-md border border-border bg-muted/30 px-3 py-2">{item}</div>
        )) : <div className="text-muted-foreground">{empty}</div>}
      </CardContent>
    </Card>
  );
}

export default function AutonomyPage() {
  const snapshot = getAutonomyOpsSnapshot();
  let humanActions: HumanRequiredAction[] = [];
  let humanActionsError: string | null = null;
  try {
    humanActions = listHumanRequiredActions();
  } catch (error) {
    humanActionsError = error instanceof Error ? error.message : String(error);
  }
  const data = snapshot.ok ? snapshot.data : null;
  const state = data?.operatorState ?? "attention";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Autonomy Ops</p>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Self-Management Posture</h1>
          <p className="text-sm text-muted-foreground">Read-only view of bounded recovery, stale signals, and operator-required actions.</p>
        </div>
        <Badge variant="outline" className={tone[state]}>{state.toUpperCase()}</Badge>
      </div>

      {!snapshot.ok ? (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardHeader><CardTitle className="text-base">Autonomy artifact unavailable</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">{snapshot.error}</CardContent>
        </Card>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <Card><CardContent className="flex items-center gap-3 p-4"><Activity className="h-5 w-5" /><div><div className="text-2xl font-semibold">{data.counts.autoRemediated}</div><div className="text-xs text-muted-foreground">Auto-fixed</div></div></CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 p-4"><ShieldAlert className="h-5 w-5" /><div><div className="text-2xl font-semibold">{data.counts.escalated}</div><div className="text-xs text-muted-foreground">Escalated</div></div></CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 p-4"><AlertTriangle className="h-5 w-5" /><div><div className="text-2xl font-semibold">{humanActions.length}</div><div className="text-xs text-muted-foreground">Human-required</div></div></CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 p-4"><Clock3 className="h-5 w-5" /><div><div className="text-sm font-medium"><TimeLabel iso={data.freshUntil} /></div><div className="text-xs text-muted-foreground">{snapshot.stale ? "Stale cache" : "Fresh until"}</div></div></CardContent></Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
            <Card>
              <CardHeader><CardTitle className="text-base">Human-Required Actions</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {humanActionsError ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertTriangle className="h-4 w-4" />Queue unavailable: {humanActionsError}
                  </div>
                ) : humanActions.length ? humanActions.map((item) => (
                  <div key={item.id} className="rounded-md border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{item.summary}</div>
                        <div className="mt-1 text-sm text-muted-foreground">{item.requiredAction}</div>
                      </div>
                      <Badge variant="outline">{item.severity}</Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">{item.system} · seen <TimeLabel iso={item.lastSeenAt} /></div>
                  </div>
                )) : <div className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4" />No open human-required actions.</div>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Source Freshness</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.sources.map((source) => (
                  <div key={source.key} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                    <span>{source.label}</span>
                    <Badge variant="outline">{source.status}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <ListBlock title="Auto-Fixed" items={data.sections.autoFixed} empty="No recent auto-fixes." />
            <ListBlock title="Degraded" items={data.sections.degraded} empty="No degraded autonomy lanes." />
            <ListBlock title="Blocked" items={data.sections.blockers} empty="No active blockers." />
          </div>
        </>
      ) : null}
    </div>
  );
}
