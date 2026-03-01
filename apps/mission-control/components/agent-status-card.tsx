"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AgentStatus = {
  name: string;
  role: string;
  lastActive: string | null;
  relativeTime: string;
};

type AgentStatusResponse = {
  source: "cortana" | "app";
  agents: AgentStatus[];
};

const POLL_MS = 45_000;

export function AgentStatusCard() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [source, setSource] = useState<"cortana" | "app" | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-status", { cache: "no-store" });
      if (!res.ok) throw new Error("agent-status fetch failed");
      const payload = (await res.json()) as AgentStatusResponse;
      setAgents(payload.agents);
      setSource(payload.source);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = window.setInterval(fetchStatus, POLL_MS);
    return () => window.clearInterval(interval);
  }, [fetchStatus]);

  return (
    <Card className="lg:col-span-1">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          Agent status
          <Badge variant="outline">live</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? <p className="text-sm text-muted-foreground">Loading agents…</p> : null}

        {!loading && agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agent activity yet.</p>
        ) : null}

        {agents.map((agent: any) => (
          <div key={agent.name} className="rounded-lg border bg-card/60 px-3 py-3 shadow-sm">
            <p className="font-medium leading-tight">{agent.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              last deployed {agent.relativeTime}
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground/80">
              {agent.role}
            </p>
          </div>
        ))}

        <p className="text-[11px] text-muted-foreground">
          refresh {POLL_MS / 1000}s {source ? `· ${source} db` : ""}
        </p>

        {error ? (
          <p className="text-xs text-amber-500">Status feed unavailable. Retrying…</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
