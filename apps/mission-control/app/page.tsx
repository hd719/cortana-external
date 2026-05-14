import Link from "next/link";
import { getDashboardSummary } from "@/lib/data";
import { Animate } from "@/components/animate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { ActivityFeed } from "@/components/activity-feed";
import { KpiRail } from "@/components/kpi-rail";
import { QuickActionsPills } from "@/components/quick-actions-pills";
import { RecentSessionsCard } from "@/components/recent-sessions-card";
import { RunPill } from "@/components/run-pill";
import { StatusStrip } from "@/components/status-strip";
import { VacationOpsBanner } from "@/components/vacation-ops-banner";

export const dynamic = "force-dynamic";

const AGENT_ROLE_VARIANTS: Record<string, { label: string; className: string }> = {
  monitor: { label: "Monitor", className: "agent-role-monitor" },
  librarian: { label: "Librarian", className: "agent-role-librarian" },
};

function getAgentRole(assignmentLabel?: string | null, fallbackName?: string | null) {
  const source = (assignmentLabel || fallbackName || "").toLowerCase().trim();
  const prefix = source.split(/[-_\s]/)[0];
  if (prefix && AGENT_ROLE_VARIANTS[prefix]) return AGENT_ROLE_VARIANTS[prefix];
  return { label: "Cortana", className: "agent-role-cortana" };
}

function getTaskSlug(assignmentLabel?: string | null, fallbackName?: string | null): string {
  const source = (assignmentLabel || fallbackName || "").trim();
  const parts = source.split(/[-_\s]/);
  const prefix = parts[0]?.toLowerCase();
  if (prefix && AGENT_ROLE_VARIANTS[prefix] && parts.length > 1) return parts.slice(1).join("-");
  return source || "unassigned";
}

function getRunToneClass(statusValue: string) {
  const s = statusValue.toLowerCase();
  if (s === "running") return "run-card-running";
  if (s === "queued") return "run-card-queued";
  if (s === "failed") return "run-card-failed";
  if (s === "done" || s === "completed") return "run-card-done";
  if (s === "timeout" || s === "stale") return "run-card-timeout";
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
        <CardHeader><CardTitle className="text-lg">Mission Control not ready</CardTitle></CardHeader>
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
  const activeAgents = data.agents.filter((a: (typeof data.agents)[number]) => a.status === "active").length;
  const runIsActive = (r: (typeof data.runs)[number]) => {
    const effective = (r.externalStatus || r.status).toString().toLowerCase();
    return effective === "running" || effective === "queued";
  };
  const activeRuns = data.runs.filter(runIsActive).length;
  const runningRuns = data.runs.filter((r: (typeof data.runs)[number]) => (r.externalStatus || r.status).toString().toLowerCase() === "running").length;
  const queuedRuns = data.runs.filter((r: (typeof data.runs)[number]) => (r.externalStatus || r.status).toString().toLowerCase() === "queued").length;
  const failedRuns = data.metrics.runs.byStatus.failed || 0;
  const openAlerts = (data.metrics.alerts.bySeverity.warning || 0) + (data.metrics.alerts.bySeverity.critical || 0);

  const visibleRuns = data.runs.slice(0, 5);

  return (
    <div className="space-y-2">
      {/* Header + quick actions */}
      <Animate delay={0.04}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Cortana Ops</p>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Mission Control</h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <Link href="/services?tab=agents" className="hover:text-foreground hover:underline">
                {totalAgents} agents · {activeAgents} active
              </Link>
              <span className="text-muted-foreground/40">·</span>
              <Link href="/jobs" className="hover:text-foreground hover:underline">
                {activeRuns} active runs
              </Link>
              {openAlerts > 0 ? (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <Link
                    href="/logs?view=logs&rangeHours=24&severity=alerts"
                    className="font-medium text-red-600 hover:underline dark:text-red-400"
                  >
                    {openAlerts} alerts (24h)
                  </Link>
                </>
              ) : null}
              {failedRuns > 0 ? (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <Link href="/jobs" className="font-medium text-red-600 hover:underline dark:text-red-400">
                    {failedRuns} failed (24h)
                  </Link>
                </>
              ) : null}
            </p>
          </div>
          <div className="shrink-0">
            <QuickActionsPills />
          </div>
        </div>
      </Animate>

      {/* Live status strip */}
      <Animate delay={0.08}>
        <StatusStrip />
      </Animate>

      {/* Vacation Ops banner (auto-expands on incidents) */}
      <Animate delay={0.12}>
        <VacationOpsBanner />
      </Animate>

      {/* Main 2-col: KPI rail (left) + Activity Feed (right). On mobile, feed renders above rail. */}
      <Animate delay={0.18}>
        <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="order-2 lg:order-1">
            <KpiRail />
          </div>
          <Card className="order-1 flex min-w-0 flex-col gap-2 overflow-hidden py-3 lg:order-2">
            <CardHeader className="gap-1 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold uppercase tracking-wide">Activity Feed</CardTitle>
                <Link href="/services" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                  View logs
                </Link>
              </div>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-1 flex-col px-4">
              <ActivityFeed />
            </CardContent>
          </Card>
        </div>
      </Animate>

      {/* Bottom row: Recent Runs + Recent Sessions */}
      <Animate delay={0.24}>
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="gap-2 py-3">
            <CardHeader className="gap-1 px-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <CardTitle className="text-sm font-semibold uppercase tracking-wide">Recent Subagent Runs</CardTitle>
                  <div className="flex gap-1.5">
                    <RunPill label="Running" count={runningRuns} tone="emerald" />
                    <RunPill label="Queued" count={queuedRuns} tone="amber" />
                    <RunPill label="Failed" count={failedRuns} tone="red" />
                  </div>
                </div>
                <Link href="/jobs" className="text-xs text-muted-foreground hover:text-foreground hover:underline">View all</Link>
              </div>
            </CardHeader>
            <CardContent className="px-4">

              {/* Mobile cards */}
              <div className="space-y-2 md:hidden">
                {visibleRuns.map((run: (typeof data.runs)[number]) => {
                  const effectiveStatus = (run.externalStatus || run.status).toString().toLowerCase();
                  const role = getAgentRole(run.assignmentLabel, run.agent?.name);
                  return (
                    <div key={run.id} className={`rounded-lg border p-3 ${getRunToneClass(effectiveStatus)}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{run.jobType}</p>
                          <p className="line-clamp-1 text-xs text-muted-foreground">{run.summary || "No summary"}</p>
                        </div>
                        <StatusBadge value={run.externalStatus || run.status} variant="run" />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge className={role.className}>{role.label}</Badge>
                        <span className="truncate text-[11px] text-muted-foreground">{run.startedAt.toLocaleString()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block">
                <table className="w-full text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr className="border-b border-border/40">
                      <th className="pb-2 pr-3 font-medium">Run</th>
                      <th className="pb-2 pr-3 font-medium">Agent</th>
                      <th className="pb-2 pr-3 font-medium">Status</th>
                      <th className="pb-2 font-medium">Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRuns.map((run: (typeof data.runs)[number]) => {
                      const role = getAgentRole(run.assignmentLabel, run.agent?.name);
                      return (
                        <tr key={run.id} className="border-b border-border/20 last:border-0">
                          <td className="py-1.5 pr-3">
                            <p className="font-medium">{run.jobType}</p>
                            <p className="line-clamp-1 max-w-[280px] text-xs text-muted-foreground">{run.summary || "No summary"}</p>
                          </td>
                          <td className="py-1.5 pr-3">
                            <div className="flex items-center gap-1.5">
                              <Badge className={role.className}>{role.label}</Badge>
                              <span className="truncate text-xs text-muted-foreground">{getTaskSlug(run.assignmentLabel, run.agent?.name)}</span>
                            </div>
                          </td>
                          <td className="py-1.5 pr-3">
                            <StatusBadge value={run.externalStatus || run.status} variant="run" />
                          </td>
                          <td className="py-1.5 text-xs text-muted-foreground">{run.startedAt.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <RecentSessionsCard />
        </div>
      </Animate>
    </div>
  );
}
