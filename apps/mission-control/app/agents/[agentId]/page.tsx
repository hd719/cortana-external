import Link from "next/link";
import { notFound } from "next/navigation";
import { getAgentDetail } from "@/lib/data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/auto-refresh";

const dtf = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  const detail = await getAgentDetail(agentId);

  if (!detail) {
    notFound();
  }

  const { agent, recentRuns, recentEvents, failureEvents } = detail;

  return (
    <div className="space-y-6">
      <AutoRefresh />
      <div className="space-y-3">
        <Link href="/agents" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to agents
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Agent detail</p>
            <h1 className="text-3xl font-semibold tracking-tight">{agent.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{agent.description || agent.role}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge value={agent.status} variant="agent" />
            <Badge variant="outline">Health: {agent.healthScore ?? "—"}</Badge>
            <Badge variant="secondary">Last seen: {agent.lastSeen ? dtf.format(agent.lastSeen) : "Unknown"}</Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent runs</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{recentRuns.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Failures / timeouts</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-destructive">{failureEvents.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Capabilities</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{agent.capabilities || "—"}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {recentRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            recentRuns.map((run) => (
              <div key={run.id} className="rounded-md border p-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-foreground">{run.jobType}</p>
                  <StatusBadge value={run.status} variant="run" />
                  <Badge variant={run.timedOut ? "destructive" : "outline"}>
                    {run.timedOut ? "timeout" : `duration ${run.durationLabel}`}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{dtf.format(run.startedAt)}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{run.summary || "No summary"}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Latest logs & alerts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {recentEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            recentEvents.map((event) => {
              const isFailure =
                event.severity === "critical" ||
                event.type.toLowerCase().includes("fail") ||
                event.type.toLowerCase().includes("timeout") ||
                event.message.toLowerCase().includes("timeout");

              return (
                <div
                  key={event.id}
                  className={`rounded-md border p-3 shadow-sm ${isFailure ? "border-destructive/50 bg-destructive/5" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge value={event.severity} variant="severity" />
                    <Badge variant={isFailure ? "destructive" : "secondary"}>{event.type}</Badge>
                    {event.run && (
                      <Badge variant="outline">Run: {event.run.jobType}</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">{dtf.format(event.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{event.message}</p>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
