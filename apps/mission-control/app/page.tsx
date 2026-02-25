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
import { AutonomyGauge } from "@/components/autonomy-gauge";
// Agent status moved to /agents roster page
// import { AgentStatusCard } from "@/components/agent-status-card";
import { QuickActionsCard } from "@/components/quick-actions-card";

export const dynamic = "force-dynamic";

const AGENT_ROLE_VARIANTS: Record<string, { label: string; className: string }> = {
  huragok: { label: "Huragok", className: "agent-role-huragok" },
  researcher: { label: "Researcher", className: "agent-role-researcher" },
  monitor: { label: "Monitor", className: "agent-role-monitor" },
  oracle: { label: "Oracle", className: "agent-role-oracle" },
  librarian: { label: "Librarian", className: "agent-role-librarian" },
};

function getAgentRole(assignmentLabel?: string | null, fallbackName?: string | null) {
  const source = (assignmentLabel || fallbackName || "").toLowerCase().trim();
  const prefix = source.split(/[-_\s]/)[0];

  if (prefix && AGENT_ROLE_VARIANTS[prefix]) {
    return AGENT_ROLE_VARIANTS[prefix];
  }

  return { label: "Cortana", className: "agent-role-cortana" };
}

function getRunToneClass(statusValue: string) {
  const status = statusValue.toLowerCase();

  if (status === "running") return "run-card-running";
  if (status === "queued") return "run-card-queued";
  if (status === "failed") return "run-card-failed";
  if (status === "done" || status === "completed") return "run-card-done";
  if (status === "timeout" || status === "stale") return "run-card-timeout";

  return "run-card-default";
}

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
            <li>
              Run <code className="font-mono">pnpm db:migrate</code>.
            </li>
            <li>
              Seed starter data with <code className="font-mono">pnpm db:seed</code>.
            </li>
            <li>
              Restart the dev server: <code className="font-mono">pnpm dev</code>.
            </li>
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
  const agentsDescription =
    degradedAgents === 0
      ? `${activeAgents} active`
      : degradedAgents === 1
        ? `${activeAgents} active · 1 needs attention`
        : `${activeAgents} active · ${degradedAgents} need attention`;
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
        <div className="grid w-full grid-cols-2 gap-3 sm:w-auto sm:grid-cols-4">
          <HeartbeatPulse />
          <ThinkingIndicator />
          <div className="flex h-full flex-col justify-center rounded-lg border bg-card/60 px-3 py-2 shadow-sm">
            <Badge variant="secondary">Connected to Postgres</Badge>
          </div>
          <AutonomyGauge />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Agents" value={totalAgents} description={agentsDescription} />
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

      <TodayStatsCard />
      <QuickActionsCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Runs & jobs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border border-emerald-200/70 bg-emerald-50/70 p-3 dark:border-emerald-900/70 dark:bg-emerald-950/20">
              <p className="text-xs text-emerald-800 dark:text-emerald-300">Running</p>
              <p className="text-xl font-semibold text-emerald-700 dark:text-emerald-200">
                {runningRuns}
              </p>
            </div>
            <div className="rounded-lg border border-amber-200/70 bg-amber-50/70 p-3 dark:border-amber-900/70 dark:bg-amber-950/20">
              <p className="text-xs text-amber-800 dark:text-amber-300">Queued</p>
              <p className="text-xl font-semibold text-amber-700 dark:text-amber-200">
                {queuedRuns}
              </p>
            </div>
            <div className="rounded-lg border border-red-200/70 bg-red-50/70 p-3 dark:border-red-900/70 dark:bg-red-950/20">
              <p className="text-xs text-red-800 dark:text-red-300">Failed (24h)</p>
              <p className="text-xl font-semibold text-red-700 dark:text-red-200">
                {data.metrics.runs.byStatus.failed || 0}
              </p>
            </div>
          </div>

          <div className="space-y-3 md:hidden">
            {data.runs.map((run) => {
              const effectiveStatus = (run.externalStatus || run.status).toString().toLowerCase();
              const role = getAgentRole(run.assignmentLabel, run.agent?.name);

              return (
                <div
                  key={run.id}
                  className={`rounded-lg border p-3 shadow-sm ${getRunToneClass(effectiveStatus)}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{run.jobType}</p>
                      <p className="line-clamp-2 break-words text-xs text-muted-foreground">
                        {run.summary || "No summary"}
                      </p>
                    </div>
                    <StatusBadge value={run.externalStatus || run.status} variant="run" />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge className={role.className}>{role.label}</Badge>
                    <Badge variant="outline" className="max-w-full font-mono text-[10px]">
                      {(run.assignmentLabel || run.agent?.name || "unassigned").slice(0, 8)}
                    </Badge>
                    {(run.externalStatus === "timeout" || run.externalStatus === "failed") && (
                      <Badge variant="destructive">attention</Badge>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide">Run ID</p>
                      <p className="font-mono text-foreground">{run.id.slice(0, 8)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide">Started</p>
                      <p className="break-words">{run.startedAt.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hidden rounded-md border md:block">
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
                {data.runs.map((run) => {
                  const role = getAgentRole(run.assignmentLabel, run.agent?.name);
                  return (
                    <tr key={run.id} className="border-t">
                      <td className="px-3 py-2 font-medium text-foreground">
                        {run.jobType}
                        <div className="line-clamp-1 max-w-[320px] text-xs text-muted-foreground">
                          {run.summary || "No summary"}
                        </div>
                        <div className="mt-1 text-[10px] font-mono text-muted-foreground">
                          {run.id}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Badge className={role.className}>{role.label}</Badge>
                          <span className="truncate">
                            {run.assignmentLabel || run.agent?.name || "Unassigned"}
                          </span>
                        </div>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

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
            <CardTitle className="text-base">API endpoints</CardTitle>
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
