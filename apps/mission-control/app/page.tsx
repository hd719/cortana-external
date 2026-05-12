import Link from "next/link";
import { getDashboardSummary } from "@/lib/data";
import { Animate } from "@/components/animate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { HeartbeatPulse } from "@/components/heartbeat-pulse";
import { ThinkingIndicator } from "@/components/thinking-indicator";
import { ActivityFeed } from "@/components/activity-feed";
import { TodayStatsCard } from "@/components/today-stats-card";
import { FitnessCard } from "@/components/fitness-card";
import { AutonomyGauge } from "@/components/autonomy-gauge";
import { DbStatus } from "@/components/db-status";
import { QuickActionsCard } from "@/components/quick-actions-card";
import { ReliabilitySloCard } from "@/components/reliability-slo-card";
import { VacationOpsCard } from "@/components/vacation-ops-card";
import { RecentSessionsCard } from "@/components/recent-sessions-card";

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
  const degradedAgents = data.agents.filter((a: (typeof data.agents)[number]) => ["degraded", "offline"].includes(a.status)).length;
  const runIsActive = (r: (typeof data.runs)[number]) => {
    const effective = (r.externalStatus || r.status).toString().toLowerCase();
    return effective === "running" || effective === "queued";
  };
  const activeRuns = data.runs.filter(runIsActive).length;
  const runningRuns = data.runs.filter((r: (typeof data.runs)[number]) => (r.externalStatus || r.status).toString().toLowerCase() === "running").length;
  const queuedRuns = data.runs.filter((r: (typeof data.runs)[number]) => (r.externalStatus || r.status).toString().toLowerCase() === "queued").length;
  const latestTrackedRun = data.runs[0] ?? null;
  const latestTrackedRunLabel = latestTrackedRun
    ? latestTrackedRun.startedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;
  const openAlerts = (data.metrics.alerts.bySeverity.warning || 0) + (data.metrics.alerts.bySeverity.critical || 0);

  return (
    <div className="space-y-4">
      {/* ── Row 1: Header ── */}
      <Animate delay={0.04}>
        <div className="space-y-1">
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Cortana Ops</p>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Mission Control</h1>
          <p className="text-sm text-muted-foreground">
            Live view of agents, jobs, and health signals.
          </p>
        </div>
      </Animate>

      {/* ── Row 1b: Live Indicators ── */}
      <Animate delay={0.08}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Link href="/services"><HeartbeatPulse /></Link>
          <Link href="/services"><ThinkingIndicator /></Link>
          <Link href="/services"><DbStatus /></Link>
          <Link href="/services"><AutonomyGauge /></Link>
        </div>
      </Animate>

      {/* ── Row 2: Key Metrics Strip ── */}
      <Animate delay={0.14}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            label="Agents"
            value={String(totalAgents)}
            detail={degradedAgents === 0 ? `${activeAgents} active` : `${activeAgents} active · ${degradedAgents} degraded`}
            tone={degradedAgents > 0 ? "amber" : "emerald"}
            href="/services?tab=agents"
          />
          <MetricCard
            label="Active Runs"
            value={String(activeRuns)}
            detail={`${runningRuns} running · ${queuedRuns} queued`}
            tone={activeRuns > 0 ? "emerald" : "neutral"}
            href="/jobs"
          />
          <MetricCard
            label="Alerts (24h)"
            value={String(openAlerts)}
            detail={`${data.metrics.alerts.total} total logged`}
            tone={openAlerts > 0 ? "red" : "emerald"}
            href="/logs?view=logs&rangeHours=24&severity=alerts"
          />
          <MetricCard
            label="Failed (24h)"
            value={String(data.metrics.runs.byStatus.failed || 0)}
            detail={`${data.metrics.runs.total} total tracked`}
            tone={(data.metrics.runs.byStatus.failed || 0) > 0 ? "red" : "emerald"}
            href="/jobs"
          />
        </div>
      </Animate>

      <Animate delay={0.17}>
        <VacationOpsCard />
      </Animate>

      {/* ── Row 3: Today Stats + Fitness ── */}
      <Animate delay={0.20}>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr] [&>a]:block [&>a]:h-full [&_[data-slot=card]]:h-full">
          <Link href="/services"><TodayStatsCard className="h-full" /></Link>
          <Link href="/mjolnir"><FitnessCard className="h-full" /></Link>
        </div>
      </Animate>

      {/* ── Row 4: Reliability + Quick Actions ── */}
      <Animate delay={0.26}>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
          <Link href="/services" className="block"><ReliabilitySloCard /></Link>
          <QuickActionsCard />
        </div>
      </Animate>

      {/* ── Row 5: Runs + Sessions + Activity Feed ── */}
      <Animate delay={0.32}>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2.4fr_1.4fr_1.8fr] xl:items-stretch">
        {/* Runs */}
        <Card className="gap-3 py-4">
          <CardHeader className="gap-1 px-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm font-semibold uppercase tracking-wide">Recent Subagent Runs</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {latestTrackedRunLabel
                    ? `Tracked OpenClaw subagent jobs, latest ${latestTrackedRunLabel}`
                    : "Tracked OpenClaw subagent jobs"}
                </p>
              </div>
              <Link href="/jobs" className="text-xs text-muted-foreground hover:text-foreground hover:underline">View all</Link>
            </div>
          </CardHeader>
          <CardContent className="px-5">
            {/* Run status pills */}
            <div className="mb-3 flex gap-2">
              <RunPill label="Running" count={runningRuns} tone="emerald" />
              <RunPill label="Queued" count={queuedRuns} tone="amber" />
              <RunPill label="Failed" count={data.metrics.runs.byStatus.failed || 0} tone="red" />
            </div>

            {/* Mobile cards */}
            <div className="space-y-2 md:hidden">
              {data.runs.map((run: (typeof data.runs)[number]) => {
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
                  {data.runs.map((run: (typeof data.runs)[number]) => {
                    const role = getAgentRole(run.assignmentLabel, run.agent?.name);
                    return (
                      <tr key={run.id} className="border-b border-border/20 last:border-0">
                        <td className="py-2.5 pr-3">
                          <p className="font-medium">{run.jobType}</p>
                          <p className="line-clamp-1 max-w-[280px] text-xs text-muted-foreground">{run.summary || "No summary"}</p>
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-1.5">
                            <Badge className={role.className}>{role.label}</Badge>
                            <span className="truncate text-xs text-muted-foreground">{getTaskSlug(run.assignmentLabel, run.agent?.name)}</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-3">
                          <StatusBadge value={run.externalStatus || run.status} variant="run" />
                        </td>
                        <td className="py-2.5 text-xs text-muted-foreground">{run.startedAt.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <RecentSessionsCard />

        {/* Activity Feed */}
        <Card className="flex min-w-0 flex-col gap-3 overflow-hidden py-4">
          <CardHeader className="gap-1 px-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide">Activity Feed</CardTitle>
              <Link href="/services" className="text-xs text-muted-foreground hover:text-foreground hover:underline">View logs</Link>
            </div>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-1 flex-col px-5">
            <ActivityFeed />
          </CardContent>
        </Card>
        </div>
      </Animate>
    </div>
  );
}

/* ── sub-components ── */

function MetricCard({ label, value, detail, tone, href }: {
  label: string; value: string; detail: string;
  tone: "emerald" | "amber" | "red" | "neutral";
  href?: string;
}) {
  const toneMap = {
    emerald: "border-l-emerald-500 dark:border-l-emerald-400",
    amber: "border-l-amber-500 dark:border-l-amber-400",
    red: "border-l-red-500 dark:border-l-red-400",
    neutral: "border-l-border",
  };
  const valueTone = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-red-600 dark:text-red-400",
    neutral: "text-foreground",
  };

  const inner = (
    <div className={`rounded-lg border border-border/50 border-l-[3px] bg-card/60 p-3 transition-colors ${toneMap[tone]} ${href ? "hover:bg-muted/30" : ""}`}>
      <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-bold leading-tight ${valueTone[tone]}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );

  return href ? <Link href={href}>{inner}</Link> : inner;
}

function RunPill({ label, count, tone }: { label: string; count: number; tone: "emerald" | "amber" | "red" }) {
  const cls = {
    emerald: "border-emerald-200/70 bg-emerald-50/60 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200",
    amber: "border-amber-200/70 bg-amber-50/60 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200",
    red: "border-red-200/70 bg-red-50/60 text-red-800 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-200",
  };
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${cls[tone]}`}>
      <span>{label}</span>
      <span className="font-mono font-bold">{count}</span>
    </div>
  );
}
