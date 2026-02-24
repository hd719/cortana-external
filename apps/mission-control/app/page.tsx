import { RunStatus } from "@prisma/client";
import { getDashboardSummary } from "@/lib/data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { StatCard } from "@/components/stat-card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

export default async function Home() {
  let data: Awaited<ReturnType<typeof getDashboardSummary>> | null = null;
  let error: string | null = null;

  try {
    data = await getDashboardSummary();
  } catch (err) {
    console.error("Failed to load dashboard data", err);
    error = "Database connection failed. Set DATABASE_URL and run migrations.";
  }

  if (!data) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-lg">Mission Control not ready</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>{error}</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Copy .env.example to .env.local and update DATABASE_URL.</li>
            <li>Run <code className="font-mono">pnpm db:migrate</code>.</li>
            <li>Seed starter data with <code className="font-mono">pnpm db:seed</code>.</li>
            <li>Restart the dev server: <code className="font-mono">pnpm dev</code>.</li>
          </ol>
        </CardContent>
      </Card>
    );
  }

  const totalAgents = data.metrics.agents.total;
  const activeAgents = data.agents.filter((a) => a.status === "active").length;
  const degradedAgents = data.agents.filter((a) =>
    ["degraded", "offline"].includes(a.status)
  ).length;
  const activeRuns = data.runs.filter(
    (r) => r.status === RunStatus.running || r.status === RunStatus.queued
  ).length;
  const openAlerts =
    (data.metrics.alerts.bySeverity.warning || 0) +
    (data.metrics.alerts.bySeverity.critical || 0);

  return (
    <div className="space-y-6">
      <AutoRefresh />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Cortana Ops
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Mission Control</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live view of agents, jobs, and health signals. Backed by PostgreSQL +
            Prisma.
          </p>
        </div>
        <Badge variant="secondary" className="h-fit">Connected to Postgres</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Agents"
          value={totalAgents}
          description={`${activeAgents} active · ${degradedAgents} needs attention`}
        />
        <StatCard
          title="Active runs"
          value={activeRuns}
          description={`${data.metrics.runs.total} total tracked`}
        />
        <StatCard
          title="Alerts (24h)"
          value={openAlerts}
          description={`${data.metrics.alerts.total} logged`}
        />
        <StatCard
          title="Recent events"
          value={data.events.length}
          description="Latest signals and notifications"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              Agent health
              <Badge variant="outline">live</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.agents.map((agent) => (
              <div
                key={agent.id}
                className="rounded-lg border bg-card/60 px-3 py-3 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium leading-tight">{agent.name}</p>
                    <p className="text-xs text-muted-foreground">{agent.role}</p>
                  </div>
                  <StatusBadge value={agent.status} variant="agent" />
                </div>
                <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Health</span>
                    <span className="font-medium text-foreground">
                      {agent.healthScore ?? "—"}
                    </span>
                  </div>
                  <Progress value={agent.healthScore ?? 0} />
                  <p className="leading-tight">{agent.description}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Runs & jobs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm text-muted-foreground">
              <div className="rounded-lg border bg-card/50 p-3">
                <p className="text-xs">Running</p>
                <p className="text-xl font-semibold text-foreground">
                  {data.metrics.runs.byStatus.running || 0}
                </p>
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <p className="text-xs">Queued</p>
                <p className="text-xl font-semibold text-foreground">
                  {data.metrics.runs.byStatus.queued || 0}
                </p>
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <p className="text-xs">Failed (24h)
                </p>
                <p className="text-xl font-semibold text-destructive">
                  {data.metrics.runs.byStatus.failed || 0}
                </p>
              </div>
            </div>
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/70 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Run</th>
                    <th className="px-3 py-2">Agent</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((run) => (
                    <tr key={run.id} className="border-t">
                      <td className="px-3 py-2 font-medium text-foreground">
                        {run.jobType}
                        <div className="text-xs text-muted-foreground">
                          {run.summary || "No summary"}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {run.agent?.name || "Unassigned"}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge value={run.status} variant="run" />
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {run.startedAt.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Latest alerts & events</CardTitle>
          </CardHeader>
          <CardContent className="divide-y text-sm">
            {data.events.map((event) => (
              <div
                key={event.id}
                className="flex items-start justify-between gap-3 py-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      value={event.severity}
                      variant="severity"
                    />
                    <p className="font-medium text-foreground">
                      {event.type}
                    </p>
                  </div>
                  <p className="text-muted-foreground">{event.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {event.agent?.name ? `Agent: ${event.agent.name}` : "Unscoped"}
                  </p>
                </div>
                <div className="text-xs text-muted-foreground">
                  {event.createdAt.toLocaleString()}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Use server actions or API routes to pull live data.</p>
            <ul className="list-disc space-y-1 pl-4">
              <li>
                API: <code className="font-mono text-foreground">/api/dashboard</code>
              </li>
              <li>
                API: <code className="font-mono text-foreground">/api/agents</code>
              </li>
              <li>
                API: <code className="font-mono text-foreground">/api/runs</code>
              </li>
            </ul>
            <p className="text-xs">
              Data is sourced directly from PostgreSQL via Prisma. Swap the
              connection string in <code className="font-mono">.env.local</code>
              to point at staging or production.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
