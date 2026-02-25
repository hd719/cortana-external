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

const AGENT_ROLE_VARIANTS: Record<string, { label: string; className: string }> = {
  huragok: { label: "Huragok", className: "agent-role-huragok" },
  researcher: { label: "Researcher", className: "agent-role-researcher" },
  monitor: { label: "Monitor", className: "agent-role-monitor" },
  oracle: { label: "Oracle", className: "agent-role-oracle" },
  librarian: { label: "Librarian", className: "agent-role-librarian" },
};

function getAgentRole(assignmentLabel?: string | null, fallbackName?: string | null) {
  const source = (assignmentLabel || fallbackName || "").toLowerCase().trim();
  const prefix = source.split(/[-_\s]/)[0];

  if (prefix && AGENT_ROLE_VARIANTS[prefix]) {
    return AGENT_ROLE_VARIANTS[prefix];
  }

  return { label: "Cortana", className: "agent-role-cortana" };
}

function getRunToneClass(statusValue: string) {
  const status = statusValue.toLowerCase();

  if (status === "running") return "run-card-running";
  if (status === "queued") return "run-card-queued";
  if (status === "failed") return "run-card-failed";
  if (status === "done" || status === "completed") return "run-card-done";
  if (status === "timeout" || status === "stale") return "run-card-timeout";

  return "run-card-default";
}

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
    <div className="space-y-4">
      <div className="space-y-3 md:hidden">
        {runs.map((run) => {
          const effectiveStatus = (run.externalStatus || run.status).toString().toLowerCase();
          const role = getAgentRole(run.assignmentLabel, run.agent?.name);

          return (
            <div
              key={run.id}
              className={`rounded-lg border p-3 shadow-sm ${getRunToneClass(effectiveStatus)}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{run.jobType}</p>
                  <p className="line-clamp-2 break-words text-xs text-muted-foreground">
                    {run.summary || "No summary"}
                  </p>
                </div>
                <StatusBadge value={run.externalStatus || run.status} variant="run" />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge className={role.className}>{role.label}</Badge>
                <Badge variant="outline" className="max-w-full font-mono text-[10px]">
                  {(run.assignmentLabel || run.agent?.name || "unassigned").slice(0, 8)}
                </Badge>
                {run.launchPhase === "phase2_running_unconfirmed" && (
                  <Badge variant="warning">launch unconfirmed</Badge>
                )}
                {run.confidence && (
                  <Badge
                    variant={
                      run.confidence === "high"
                        ? "success"
                        : run.confidence === "medium"
                          ? "warning"
                          : "outline"
                    }
                  >
                    confidence {run.confidence}
                  </Badge>
                )}
                {run.providerPath?.fallback && <Badge variant="warning">fallback path</Badge>}
                {(run.externalStatus === "timeout" || run.externalStatus === "failed") && (
                  <Badge variant="destructive">attention</Badge>
                )}
              </div>

              {run.providerPath?.label && (
                <p className="mt-2 break-words text-[11px] text-muted-foreground">
                  Path: {run.providerPath.label}
                </p>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>
                  <p className="text-[10px] uppercase tracking-wide">Run ID</p>
                  <p className="font-mono text-foreground">{run.id.slice(0, 8)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide">Started</p>
                  <p className="break-words">{formatDate(run.startedAt)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide">Completed</p>
                  <p className="break-words">
                    {run.completedAt
                      ? formatDate(run.completedAt)
                      : effectiveStatus === "running"
                        ? "In progress"
                        : "—"}
                  </p>
                </div>
              </div>
            </div>
          );
        })}

        {runs.length === 0 && (
          <div className="rounded-md border px-3 py-8 text-center text-sm text-muted-foreground">
            No runs found for this filter.
          </div>
        )}
      </div>

      <div className="hidden overflow-hidden rounded-md border md:block">
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
            {runs.map((run) => {
              const role = getAgentRole(run.assignmentLabel, run.agent?.name);

              return (
                <tr key={run.id} className="border-t">
                  <td className="px-3 py-3">
                    <div className="font-semibold text-foreground">{run.jobType}</div>
                    <div className="line-clamp-1 max-w-[360px] text-xs text-muted-foreground">
                      {run.summary || "No summary"}
                    </div>
                    {run.providerPath?.label && (
                      <div className="text-[11px] text-muted-foreground">
                        Path: {run.providerPath.label}
                      </div>
                    )}
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">{run.id}</div>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Badge className={role.className}>{role.label}</Badge>
                      <span className="truncate">
                        {run.assignmentLabel || run.agent?.name || "Unassigned"}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge value={run.externalStatus || run.status} variant="run" />
                      {(run.externalStatus === "timeout" || run.externalStatus === "failed") && (
                        <Badge variant="destructive">attention</Badge>
                      )}
                      {run.launchPhase === "phase2_running_unconfirmed" && (
                        <Badge variant="warning">launch unconfirmed</Badge>
                      )}
                      {run.confidence && (
                        <Badge
                          variant={
                            run.confidence === "high"
                              ? "success"
                              : run.confidence === "medium"
                                ? "warning"
                                : "outline"
                          }
                        >
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
                      : (run.externalStatus || run.status).toString().toLowerCase() ===
                          "running"
                        ? "In progress"
                        : "—"}
                  </td>
                </tr>
              );
            })}
            {runs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No runs found for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {runs.length > 0 && (
        <div className="flex flex-col items-center gap-2 rounded-md border bg-muted/20 px-3 py-4">
          {error && <p className="text-xs text-destructive">Failed to load more runs: {error}</p>}

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
