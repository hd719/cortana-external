import Link from "next/link";
import { getAgents } from "@/lib/data";

export const dynamic = "force-dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/auto-refresh";

const WORKER_AGENT_IDS = new Set(["huragok-worker"]);

export default async function AgentsPage() {
  const agents = await getAgents();

  const workerAgents = agents.filter((agent) => WORKER_AGENT_IDS.has(agent.id));
  const coreAgents = agents.filter((agent) => !WORKER_AGENT_IDS.has(agent.id));

  return (
    <div className="space-y-6">
      <AutoRefresh />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Agents
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Roster</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Known Cortana agents, their roles, capabilities, and recent health.
          </p>
        </div>
        <Badge variant="outline">
          Seeded core: Huragok · Oracle · Researcher · Librarian · Monitor
          {" · "}
          Workers: huragok-worker
        </Badge>
      </div>

      {workerAgents.length > 0 && (
        <Card className="border-primary/25 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-base">Execution workers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {workerAgents.map((agent: (typeof agents)[number]) => (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}`}
                className="block rounded-lg border bg-background/90 p-4 transition-colors hover:bg-muted/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-foreground">{agent.name}</div>
                    <div className="text-sm text-muted-foreground">{agent.role}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Last seen: {agent.lastSeen?.toLocaleString() || "Unknown"}
                    </div>
                  </div>
                  <StatusBadge value={agent.status} variant="agent" />
                </div>
                {(agent.modelDisplay || agent.model) && (
                  <div className="mt-2 text-[11px] font-mono text-muted-foreground">
                    {agent.modelDisplay || agent.model}
                  </div>
                )}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Core agent directory</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/70 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2">Role</th>
                <th className="hidden px-3 py-2 sm:table-cell">Capabilities</th>
                <th className="hidden px-3 py-2 sm:table-cell">Model</th>
                <th className="px-3 py-2 text-right">Health</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {coreAgents.map((agent: (typeof agents)[number]) => (
                <tr key={agent.id} className="border-t transition-colors hover:bg-muted/30">
                  <td className="px-3 py-3">
                    <Link href={`/agents/${agent.id}`} className="group block">
                      <div className="font-semibold text-foreground group-hover:text-primary">
                        {agent.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Last seen: {agent.lastSeen?.toLocaleString() || "Unknown"}
                      </div>
                      {(agent.modelDisplay || agent.model) && (
                        <div className="text-[11px] font-mono text-muted-foreground sm:hidden">
                          {agent.modelDisplay || agent.model}
                        </div>
                      )}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{agent.role}</td>
                  <td className="hidden px-3 py-3 text-sm text-muted-foreground sm:table-cell">
                    {agent.capabilities}
                  </td>
                  <td className="hidden px-3 py-3 sm:table-cell">
                    <span className="text-muted-foreground text-xs font-mono">
                      {agent.modelDisplay || agent.model || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right text-muted-foreground">
                    {typeof agent.healthScore === "number" ? agent.healthScore.toFixed(1) : "—"}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge value={agent.status} variant="agent" />
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
