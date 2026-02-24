import Link from "next/link";
import { getAgents } from "@/lib/data";

export const dynamic = "force-dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/auto-refresh";

export default async function AgentsPage() {
  const agents = await getAgents();

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
        <Badge variant="outline">Seeded: Huragok · Oracle · Researcher · Librarian · Monitor</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agent directory</CardTitle>
        </CardHeader>
        <CardContent className="overflow-hidden rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/70 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Capabilities</th>
                <th className="px-3 py-2">Health</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id} className="border-t transition-colors hover:bg-muted/30">
                  <td className="px-3 py-3">
                    <Link href={`/agents/${agent.id}`} className="group block">
                      <div className="font-semibold text-foreground group-hover:text-primary">
                        {agent.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Last seen: {agent.lastSeen?.toLocaleString() || "Unknown"}
                      </div>
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{agent.role}</td>
                  <td className="px-3 py-3 text-sm text-muted-foreground">
                    {agent.capabilities}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {agent.healthScore ?? "—"}
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
