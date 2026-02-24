import Link from "next/link";
import { getRuns } from "@/lib/data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/auto-refresh";

export default async function JobsPage({
  searchParams,
}: {
  searchParams?: Promise<{ agentId?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const selectedAgentId = params.agentId?.trim() || "";

  const runs = await getRuns();

  const agents = Array.from(
    new Map(
      runs
        .filter((run) => run.agent?.id)
        .map((run) => [run.agent!.id, { id: run.agent!.id, name: run.agent!.name }])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  const filteredRuns = selectedAgentId
    ? runs.filter((run) => run.agent?.id === selectedAgentId)
    : runs;

  const grouped = Object.values(
    filteredRuns.reduce<Record<string, { label: string; count: number }>>((acc, run) => {
      const label = run.externalStatus || run.status;
      acc[label] = acc[label] || { label, count: 0 };
      acc[label].count += 1;
      return acc;
    }, {})
  );

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);

  return (
    <div className="space-y-6">
      <AutoRefresh />
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
          {grouped.length > 0
            ? grouped
                .sort((a, b) => b.count - a.count)
                .map((item) => `${item.label}: ${item.count}`)
                .join(" · ")
            : "No runs"}
        </Badge>
      </div>

      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="text-base">Recent runs</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Link href="/jobs">
              <Badge variant={selectedAgentId ? "outline" : "secondary"}>All agents</Badge>
            </Link>
            {selectedAgentId && (
              <Link href={`/jobs?agentId=${selectedAgentId}`}>
                <Badge variant="secondary">This agent: {selectedAgent?.name || selectedAgentId}</Badge>
              </Link>
            )}
            {agents.map((agent) => (
              <Link key={agent.id} href={`/jobs?agentId=${agent.id}`}>
                <Badge variant={agent.id === selectedAgentId ? "secondary" : "outline"}>
                  {agent.name}
                </Badge>
              </Link>
            ))}
          </div>
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
              {filteredRuns.map((run) => (
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
                    <div className="flex items-center gap-2">
                      <StatusBadge value={run.externalStatus || run.status} variant="run" />
                      {(run.externalStatus === "timeout" || run.externalStatus === "failed") && (
                        <Badge variant="destructive">attention</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {run.startedAt?.toLocaleString() || "—"}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {run.completedAt
                      ? run.completedAt.toLocaleString()
                      : (run.externalStatus || run.status).toString().toLowerCase() === "running"
                        ? "In progress"
                        : "—"}
                  </td>
                </tr>
              ))}
              {filteredRuns.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No runs found for this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
