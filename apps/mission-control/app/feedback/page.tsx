import { AutoRefresh } from "@/components/auto-refresh";
import { FeedbackCard } from "@/components/feedback-card";
import { FeedbackFilters } from "@/components/feedback-filters";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FeedbackFilters as Filters, getFeedbackItems, getFeedbackMetrics } from "@/lib/feedback";

export const dynamic = "force-dynamic";

const parseNum = (value?: string) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const filters: Filters = {
    status: (params.status as Filters["status"]) ?? "all",
    remediationStatus: (params.remediationStatus as Filters["remediationStatus"]) ?? "all",
    severity: (params.severity as Filters["severity"]) ?? "all",
    category: params.category ?? undefined,
    source: (params.source as Filters["source"]) ?? "all",
    rangeHours: parseNum(params.rangeHours) ?? 24 * 14,
    limit: parseNum(params.limit) ?? 120,
  };

  const [items, metrics] = await Promise.all([
    getFeedbackItems(filters),
    getFeedbackMetrics(),
  ]);

  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });

  const categories = Array.from(new Set(items.map((item) => item.category))).sort();
  const maxDaily = Math.max(1, ...metrics.dailyCorrections.map((point) => point.count));

  const openCount = metrics.byRemediationStatus.open ?? 0;
  const resolvedCount = metrics.byRemediationStatus.resolved ?? 0;
  const totalRemediationCount = Object.values(metrics.byRemediationStatus).reduce((sum, value) => sum + value, 0);
  const resolutionRate = totalRemediationCount > 0 ? Math.round((resolvedCount / totalRemediationCount) * 100) : 0;

  return (
    <div className="space-y-6">
      <AutoRefresh />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Learning Loop</p>
          <h1 className="text-3xl font-semibold tracking-tight">Feedback Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Capture failures, triage remediation, and verify fixes are actually sticking.
          </p>
        </div>
        <Badge variant="secondary">{items.length} items</Badge>
      </div>

      <FeedbackFilters
        params={search}
        selectedStatus={filters.status ?? "all"}
        selectedRemediationStatus={filters.remediationStatus ?? "all"}
        selectedSeverity={filters.severity ?? "all"}
        selectedCategory={filters.category ?? "all"}
        categories={categories}
      />


      <Card>
        <CardHeader>
          <CardTitle className="text-base">Remediation summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="rounded border bg-card/60 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Open</p>
            <p className="text-2xl font-semibold">{openCount}</p>
          </div>
          <div className="rounded border bg-card/60 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Resolved</p>
            <p className="text-2xl font-semibold">{resolvedCount}</p>
          </div>
          <div className="rounded border bg-card/60 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Resolution rate</p>
            <p className="text-2xl font-semibold">{resolutionRate}%</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Severity breakdown</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="destructive">Critical: {metrics.bySeverity.critical ?? 0}</Badge>
          <Badge variant="warning">High: {metrics.bySeverity.high ?? 0}</Badge>
          <Badge variant="info">Medium: {metrics.bySeverity.medium ?? 0}</Badge>
          <Badge variant="secondary">Low: {metrics.bySeverity.low ?? 0}</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Remediation pipeline</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          {[
            ["new", metrics.byStatus.new ?? 0],
            ["triaged", metrics.byStatus.triaged ?? 0],
            ["in_progress", metrics.byStatus.in_progress ?? 0],
            ["verified", metrics.byStatus.verified ?? 0],
          ].map(([status, count]) => (
            <div key={status} className="rounded border bg-card/60 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{String(status).replaceAll("_", " ")}</p>
              <p className="text-2xl font-semibold">{count}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily corrections (14d)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {metrics.dailyCorrections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No corrections in the last 14 days.</p>
          ) : (
            metrics.dailyCorrections.map((point) => (
              <div key={point.day} className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{point.day}</span>
                  <span>{point.count}</span>
                </div>
                <div className="h-2 w-full rounded bg-muted">
                  <div
                    className="h-2 rounded bg-primary"
                    style={{ width: `${Math.max(4, Math.round((point.count / maxDaily) * 100))}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {items.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-sm text-muted-foreground">No feedback items match current filters.</p>
            </CardContent>
          </Card>
        ) : (
          items.map((feedback) => <FeedbackCard key={feedback.id} feedback={feedback} />)
        )}
      </div>
    </div>
  );
}
