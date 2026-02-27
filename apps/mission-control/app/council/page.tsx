import { AutoRefresh } from "@/components/auto-refresh";
import { CouncilFilters } from "@/components/council-filters";
import { CouncilSessionCard } from "@/components/council-session-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CouncilFilters as Filters, getCouncilSessions } from "@/lib/council";

export const dynamic = "force-dynamic";

const parseNum = (value?: string) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export default async function CouncilPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const filters: Filters = {
    status: (params.status as Filters["status"]) ?? undefined,
    mode: (params.mode as Filters["mode"]) ?? undefined,
    rangeHours: parseNum(params.rangeHours) ?? 24 * 7,
    limit: parseNum(params.limit) ?? 120,
  };

  const sessions = await getCouncilSessions(filters);
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });

  const running = sessions.filter((item) => item.status === "running").length;
  const decided = sessions.filter((item) => item.status === "decided").length;
  const confidenceScores = sessions
    .map((item) => item.confidence)
    .filter((value): value is number => typeof value === "number");
  const avgConfidence = confidenceScores.length
    ? (confidenceScores.reduce((sum, value) => sum + value, 0) / confidenceScores.length).toFixed(2)
    : "—";

  return (
    <div className="space-y-6">
      <AutoRefresh sourceUrl="/api/council/stream" intervalMs={2000} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Governance</p>
          <h1 className="text-3xl font-semibold tracking-tight">Council Sessions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Monitor deliberations, inspect votes, and audit final decisions.
          </p>
        </div>
        <Badge variant="secondary">{sessions.length} sessions</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Session overview</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="outline">Total: {sessions.length}</Badge>
          <Badge variant="success">Running: {running}</Badge>
          <Badge variant="info">Decided: {decided}</Badge>
          <Badge variant="secondary">Avg confidence: {avgConfidence}</Badge>
        </CardContent>
      </Card>

      <CouncilFilters
        params={search}
        selectedStatus={filters.status ?? "all"}
        selectedMode={filters.mode ?? "all"}
      />

      <div className="space-y-4">
        {sessions.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-sm text-muted-foreground">No council sessions match current filters.</p>
            </CardContent>
          </Card>
        ) : (
          sessions.map((session) => <CouncilSessionCard key={session.id} session={session} />)
        )}
      </div>
    </div>
  );
}
