import { getDashboardSummary } from "@/lib/data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/auto-refresh";
import { HeartbeatPulse } from "@/components/heartbeat-pulse";
import { ThinkingIndicator } from "@/components/thinking-indicator";
import { ActivityFeed } from "@/components/activity-feed";
import { TodayStatsCard } from "@/components/today-stats-card";
import { MoodRing } from "@/components/mood-ring";
import { AutonomyGauge } from "@/components/autonomy-gauge";
import { AgentStatusCard } from "@/components/agent-status-card";

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
  const runIsActive = (r: (typeof data.runs)[number]) => {
    const effective = (r.externalStatus || r.status).toString().toLowerCase();
    return effective === "running" || effective === "queued";
  };

  const activeRuns = data.runs.filter(runIsActive).length;
  const runningRuns = data.runs.filter(
    (r) => (r.externalStatus || r.status).toString().toLowerCase() === "running"
  ).length;
  const queuedRuns = data.runs.filter(
    (r) => (r.externalStatus || r.status).toString().toLowerCase() === "queued"
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
        <div className="flex w-full flex-wrap items-stretch gap-3 sm:w-auto sm:justify-end">
          <MoodRing />
          <HeartbeatPulse />
          <ThinkingIndicator />
          <Badge variant="secondary" className="h-fit">Connected to Postgres</Badge>
        </div>
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
        <div className="space-y-4">
          <TodayStatsCard />
          <AutonomyGauge />
        </div>

        <AgentStatusCard />

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Runs & jobs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm text-muted-foreground">
              <div className="rounded-lg border bg-card/50 p-3">
                <p className="text-xs">Running</p>
                <p className="text-xl font-semibold text-foreground">
                  {runningRuns}
                </p>
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <p className="text-xs">Queued</p>
                <p className="text-xl font-semibold text-foreground">
                  {queuedRuns}
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
                        <div className="flex items-center gap-2">
                          <StatusBadge value={run.externalStatus || run.status} variant="run" />
                          {(run.externalStatus === "timeout" || run.externalStatus === "failed") && (
                            <Badge variant="destructive">attention</Badge>
                          )}
                        </div>
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
            <CardTitle className="text-base">Mission activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityFeed />
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
              <li>
                API: <code className="font-mono text-foreground">/api/heartbeat-status</code>
              </li>
              <li>
                API: <code className="font-mono text-foreground">/api/thinking-status</code>
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
