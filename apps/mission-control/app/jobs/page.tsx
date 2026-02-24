import Link from "next/link";
import { getAgents, getRuns } from "@/lib/data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/auto-refresh";
import { JobsRunsTable } from "./jobs-runs-table";

export default async function JobsPage({
  searchParams,
}: {
  searchParams?: Promise<{ agentId?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const selectedAgentId = params.agentId?.trim() || "";

  const [agents, runsPage] = await Promise.all([
    getAgents(),
    getRuns({ agentId: selectedAgentId || undefined, take: 20 }),
  ]);

  const filteredRuns = runsPage.runs;

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
        <CardContent>
          <JobsRunsTable
            initialRuns={filteredRuns}
            initialHasMore={runsPage.hasMore}
            initialNextCursor={runsPage.nextCursor}
            agentId={selectedAgentId || undefined}
          />
        </CardContent>
      </Card>
    </div>
  );
}
