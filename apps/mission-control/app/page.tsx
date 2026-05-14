import Link from "next/link";
import { getDashboardSummary } from "@/lib/data";
import { Animate } from "@/components/animate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityFeed } from "@/components/activity-feed";
import { CollapsibleCard } from "@/components/collapsible-card";
import { KpiRail } from "@/components/kpi-rail";
import { QuickActionsPills } from "@/components/quick-actions-pills";
import { RecentSessionsTile } from "@/components/recent-sessions-tile";
import { RunPill } from "@/components/run-pill";
import { StatusStrip } from "@/components/status-strip";
import { VacationOpsBanner } from "@/components/vacation-ops-banner";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function runtimeBadge() {
  const env = (process.env.MARKET_LAB_ENV || "prod").trim().toLowerCase() === "dev" ? "dev" : "prod";
  const port = process.env.PORT || (env === "dev" ? "3001" : "3000");
  return {
    label: env === "dev" ? "DEV" : "PROD",
    port,
    className:
      env === "dev"
        ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300"
        : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  };
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
  const runtime = runtimeBadge();

  return (
    <div className="space-y-2">
      {/* Header + quick actions */}
      <Animate delay={0.04}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Cortana Ops</p>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Mission Control</h1>
              <span
                className={cn(
                  "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-widest",
                  runtime.className,
                )}
                title={`Mission Control ${runtime.label.toLowerCase()} runtime on port ${runtime.port}`}
              >
                {runtime.label}
              </span>
            </div>
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

      {/* Status strip + 3 collapsed tiles share one row at lg+; stack on mobile.
          items-start so an expanded tile grows independently without dragging the others. */}
      <Animate delay={0.1}>
        <div className="grid items-start gap-3 lg:grid-cols-4">
          <StatusStrip />
          <VacationOpsBanner />

          <CollapsibleCard
            summary={
              <div className="flex min-w-0 items-center gap-x-1.5 overflow-hidden text-[12px]">
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Runs</span>
                <RunPill label="R" count={runningRuns} tone="emerald" />
                <RunPill label="Q" count={queuedRuns} tone="amber" />
                <RunPill label="F" count={failedRuns} tone="red" />
              </div>
            }
          >
            <div className="text-[11px]">
              {visibleRuns.length === 0 ? (
                <p className="py-1 text-muted-foreground">No tracked runs.</p>
              ) : (
                visibleRuns.map((run: (typeof data.runs)[number]) => {
                  const status = String(run.externalStatus || run.status);
                  const statusLower = status.toLowerCase();
                  const tone =
                    statusLower === "failed"
                      ? "text-red-600 dark:text-red-400"
                      : statusLower === "running"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : statusLower === "queued"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground";
                  return (
                    <div
                      key={run.id}
                      className="flex items-baseline justify-between gap-2 border-b border-border/30 py-1 last:border-b-0"
                    >
                      <span className="min-w-0 truncate font-medium">{run.jobType}</span>
                      <span className="shrink-0 text-muted-foreground">
                        <span className={`mr-2 font-mono text-[10px] uppercase tracking-wider ${tone}`}>{status}</span>
                        {run.startedAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                  );
                })
              )}
              <Link
                href="/jobs"
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
              >
                View all ↗
              </Link>
            </div>
          </CollapsibleCard>

          <RecentSessionsTile />
        </div>
      </Animate>

      {/* Main 2-col: KPI rail (left) + Activity Feed (right). Both stretch to equal height. */}
      <Animate delay={0.22}>
        <div className="grid items-stretch gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="order-2 lg:order-1">
            <KpiRail />
          </div>
          <div className="order-1 flex min-w-0 flex-col lg:order-2 lg:h-full">
            <ActivityFeed />
          </div>
        </div>
      </Animate>
    </div>
  );
}
