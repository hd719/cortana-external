import { getRuns } from "@/lib/data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { RunStatus } from "@prisma/client";

export default async function JobsPage() {
  const runs = await getRuns();

  const grouped = Object.values(
    runs.reduce<Record<string, { label: string; count: number }>>((acc, run) => {
      const label = run.status;
      acc[label] = acc[label] || { label, count: 0 };
      acc[label].count += 1;
      return acc;
    }, {})
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Jobs & Runs
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Operational queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Latest runs across agents with status, timing, and ownership.
          </p>
        </div>
        <Badge variant="secondary">
          {grouped
            .sort((a, b) => b.count - a.count)
            .map((item) => `${item.label}: ${item.count}`)
            .join(" · ")}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent runs</CardTitle>
        </CardHeader>
        <CardContent className="overflow-hidden rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/70 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Run</th>
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Completed</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-t">
                  <td className="px-3 py-3">
                    <div className="font-semibold text-foreground">{run.jobType}</div>
                    <div className="text-xs text-muted-foreground">
                      {run.summary || "No summary"}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {run.agent?.name || "Unassigned"}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge value={run.status} variant="run" />
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {run.startedAt?.toLocaleString() || "—"}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {run.completedAt
                      ? run.completedAt.toLocaleString()
                      : run.status === RunStatus.running
                        ? "In progress"
                        : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
