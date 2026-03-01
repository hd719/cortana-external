import { AutoRefresh } from "@/components/auto-refresh";
import { ApprovalCard } from "@/components/approval-card";
import { ApprovalFilters } from "@/components/approval-filters";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApprovalFilters as Filters, getApprovals } from "@/lib/approvals";

export const dynamic = "force-dynamic";

const parseNum = (value?: string) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const filters: Filters = {
    status: (params.status as Filters["status"]) ?? "all",
    rangeHours: parseNum(params.rangeHours) ?? 24 * 7,
    limit: parseNum(params.limit) ?? 120,
  };

  const approvals = await getApprovals(filters);
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });

  const counts = {
    pending: approvals.filter((item: any) => item.status === "pending").length,
    approved: approvals.filter((item: any) => ["approved", "approved_edited"].includes(item.status)).length,
    rejected: approvals.filter((item: any) => item.status === "rejected").length,
    expired: approvals.filter((item: any) => item.status === "expired").length,
  };

  return (
    <div className="space-y-6">
      <AutoRefresh />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Governance</p>
          <h1 className="text-3xl font-semibold tracking-tight">Approvals Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review high-risk actions, record decisions, and preserve a complete audit trail.
          </p>
        </div>
        <Badge variant="secondary">{approvals.length} requests</Badge>
      </div>

      <ApprovalFilters params={search} selectedStatus={filters.status ?? "all"} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status breakdown</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="outline">Pending: {counts.pending}</Badge>
          <Badge variant="success">Approved: {counts.approved}</Badge>
          <Badge variant="destructive">Rejected: {counts.rejected}</Badge>
          <Badge variant="warning">Expired: {counts.expired}</Badge>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {approvals.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-sm text-muted-foreground">No approval requests match current filters.</p>
            </CardContent>
          </Card>
        ) : (
          approvals.map((approval: any) => <ApprovalCard key={approval.id} approval={approval} />)
        )}
      </div>
    </div>
  );
}
