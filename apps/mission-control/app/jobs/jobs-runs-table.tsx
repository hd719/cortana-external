"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type RunRecord = {
  id: string;
  jobType: string;
  summary: string | null;
  status: string;
  externalStatus: string | null;
  confidence?: "high" | "medium" | "low";
  launchPhase?: string;
  providerPath?: { label: string; fallback?: boolean };
  assignmentLabel?: string | null;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
  agent: { id: string; name: string } | null;
};

type RunsTableProps = {
  initialRuns: RunRecord[];
  initialHasMore: boolean;
  initialNextCursor: string | null;
  agentId?: string;
};

export function JobsRunsTable({
  initialRuns,
  initialHasMore,
  initialNextCursor,
  agentId,
}: RunsTableProps) {
  const [runs, setRuns] = useState(initialRuns);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMore = async () => {
    if (!nextCursor || loading) return;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ cursor: nextCursor, take: "20" });
      if (agentId) params.set("agentId", agentId);

      const response = await fetch(`/api/runs?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      const data = await response.json();
      setRuns((prev) => [...prev, ...(data.runs ?? [])]);
      setHasMore(Boolean(data.hasMore));
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load more runs.");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (value: string | Date | null) => {
    if (!value) return "—";
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return "—";
    return parsed.toLocaleString();
  };

  return (
    <div className="overflow-hidden rounded-md border">
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
                <div className="text-xs text-muted-foreground">{run.summary || "No summary"}</div>
                {run.providerPath?.label && (
                  <div className="text-[11px] text-muted-foreground">Path: {run.providerPath.label}</div>
                )}
              </td>
              <td className="px-3 py-3 text-muted-foreground">{run.assignmentLabel || run.agent?.name || "Unassigned"}</td>
              <td className="px-3 py-3">
                <div className="flex items-center gap-2">
                  <StatusBadge value={run.externalStatus || run.status} variant="run" />
                  {(run.externalStatus === "timeout" || run.externalStatus === "failed") && (
                    <Badge variant="destructive">attention</Badge>
                  )}
                  {run.launchPhase === "phase2_running_unconfirmed" && (
                    <Badge variant="warning">launch unconfirmed</Badge>
                  )}
                  {run.confidence && (
                    <Badge variant={run.confidence === "high" ? "success" : run.confidence === "medium" ? "warning" : "outline"}>
                      confidence {run.confidence}
                    </Badge>
                  )}
                  {run.providerPath?.fallback && <Badge variant="warning">fallback path</Badge>}
                </div>
              </td>
              <td className="px-3 py-3 text-xs text-muted-foreground">{formatDate(run.startedAt)}</td>
              <td className="px-3 py-3 text-xs text-muted-foreground">
                {run.completedAt
                  ? formatDate(run.completedAt)
                  : (run.externalStatus || run.status).toString().toLowerCase() === "running"
                    ? "In progress"
                    : "—"}
              </td>
            </tr>
          ))}
          {runs.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                No runs found for this filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {runs.length > 0 && (
        <div className="flex flex-col items-center gap-2 border-t bg-muted/20 px-3 py-4">
          {error && (
            <p className="text-xs text-destructive">
              Failed to load more runs: {error}
            </p>
          )}

          {hasMore ? (
            <Button onClick={loadMore} disabled={loading} variant="outline" size="sm">
              {loading ? "Loading..." : "Load more"}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">You’ve reached the end of results.</p>
          )}

          {error && (
            <Button onClick={loadMore} disabled={loading} variant="ghost" size="sm">
              Retry
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
