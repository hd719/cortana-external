"use client";

import { useState, type ComponentType } from "react";
import { Loader2, Play, RefreshCcw, Wallet, HeartPulse, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ActionKey = "chaos-test" | "reflection-sweep" | "check-budget" | "force-heartbeat";

type ActionConfig = {
  key: ActionKey;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

type ActionState = {
  state: "idle" | "loading" | "success" | "error";
  data?: unknown;
  message?: string;
};

type HealthCheckResult = {
  name: string;
  passed: boolean;
  details: string;
};

type ReflectionItem = {
  id: number;
  title: string;
  status: string;
  completed_at: string | null;
  outcome: string | null;
};

const ACTIONS: ActionConfig[] = [
  { key: "chaos-test", label: "Run Chaos Test", icon: Play },
  { key: "reflection-sweep", label: "Reflection Sweep", icon: RefreshCcw },
  { key: "check-budget", label: "Check Budget", icon: Wallet },
  { key: "force-heartbeat", label: "Force Heartbeat", icon: HeartPulse },
];

const prettyJson = (value: unknown) => JSON.stringify(value, null, 2);

const formatNumber = (value: unknown) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return value.toFixed(2);
};

function renderActionResult(action: ActionKey, data: unknown) {
  if (!data || typeof data !== "object") {
    return <pre className="text-xs leading-5">{prettyJson(data)}</pre>;
  }

  const payload = data as Record<string, unknown>;

  if (action === "chaos-test") {
    const checks = (payload.checks as HealthCheckResult[] | undefined) ?? [];
    return (
      <div className="space-y-2 font-mono text-xs leading-5">
        {checks.map((check: HealthCheckResult) => (
          <div key={check.name} className="rounded-md border border-border/60 bg-background/70 p-2">
            <div className={check.passed ? "text-emerald-300" : "text-destructive"}>
              {check.passed ? "PASS" : "FAIL"} · {check.name}
            </div>
            <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{check.details}</div>
          </div>
        ))}
      </div>
    );
  }

  if (action === "reflection-sweep") {
    const rows = (payload.reflections as ReflectionItem[] | undefined) ?? [];
    if (rows.length === 0) {
      return <p className="text-sm text-muted-foreground">No completed tasks in the last 24 hours.</p>;
    }

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Completed</TableHead>
            <TableHead>Outcome</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row: ReflectionItem) => (
            <TableRow key={row.id}>
              <TableCell>{row.id}</TableCell>
              <TableCell className="max-w-[260px] truncate" title={row.title}>
                {row.title}
              </TableCell>
              <TableCell>{row.status}</TableCell>
              <TableCell>
                {row.completed_at ? new Date(row.completed_at).toLocaleString() : "—"}
              </TableCell>
              <TableCell className="max-w-[320px] truncate" title={row.outcome || ""}>
                {row.outcome || "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  if (action === "check-budget") {
    const budget = (payload.budget as Record<string, unknown> | undefined) ?? {};
    return (
      <pre className="overflow-x-auto rounded-md border border-border/60 bg-background/70 p-3 font-mono text-xs leading-5">
{`source: ${String(budget.source ?? "unknown")}
used: ${formatNumber(budget.used)}
remaining: ${formatNumber(budget.remaining)}
burnRate: ${formatNumber(budget.burnRate)}
checkedAt: ${String(payload.checkedAt ?? "")}`}
      </pre>
    );
  }

  if (action === "force-heartbeat") {
    return (
      <pre className="overflow-x-auto rounded-md border border-border/60 bg-background/70 p-3 font-mono text-xs leading-5">
{`status: ok
message: ${String(payload.message ?? "Manual heartbeat inserted")}
timestamp: ${String(payload.timestamp ?? "")}`}
      </pre>
    );
  }

  return <pre className="text-xs leading-5">{prettyJson(payload)}</pre>;
}

export function QuickActionsCard() {
  const [statuses, setStatuses] = useState<Record<ActionKey, ActionState>>({
    "chaos-test": { state: "idle" },
    "reflection-sweep": { state: "idle" },
    "check-budget": { state: "idle" },
    "force-heartbeat": { state: "idle" },
  });
  const [activeAction, setActiveAction] = useState<ActionKey | null>(null);

  const runAction = async (action: ActionKey) => {
    setActiveAction(action);
    setStatuses((prev) => ({
      ...prev,
      [action]: { state: "loading", message: "Running..." },
    }));

    try {
      const response = await fetch(`/api/actions/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });

      const payload = (await response.json()) as { ok?: boolean; message?: string } & Record<string, unknown>;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Action failed");
      }

      setStatuses((prev) => ({
        ...prev,
        [action]: {
          state: "success",
          data: payload,
          message: payload.message || "Action completed",
        },

      }));

      // After force-heartbeat, tell HeartbeatPulse to refresh (delay lets the run complete)
      if (action === "force-heartbeat") {
        setTimeout(() => window.dispatchEvent(new Event("heartbeat-refresh")), 3000);
      }
    } catch (error) {
      setStatuses((prev) => ({
        ...prev,
        [action]: {
          state: "error",
          message: error instanceof Error ? error.message : "Action failed",
        },
      }));

      // After force-heartbeat, tell HeartbeatPulse to refresh (delay lets the run complete)
      if (action === "force-heartbeat") {
        setTimeout(() => window.dispatchEvent(new Event("heartbeat-refresh")), 3000);
      }
    }
  };

  const activeStatus = activeAction ? statuses[activeAction] : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {ACTIONS.map((action) => {
            const status = statuses[action.key];
            const isLoading = status.state === "loading";
            const Icon = action.icon;

            return (
              <div key={action.key} className="rounded-lg border bg-card/50 p-3">
                <Button
                  onClick={() => runAction(action.key)}
                  disabled={isLoading}
                  variant="outline"
                  className="w-full justify-start truncate border-border/70 bg-background/60"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                  {action.label}
                </Button>
              </div>
            );
          })}
        </div>

        {activeAction && activeStatus ? (
          <div className="rounded-lg border border-border/70 bg-card/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium">
                {ACTIONS.find((item) => item.key === activeAction)?.label} results
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setActiveAction(null)}
              >
                <X className="h-4 w-4" />
                Close
              </Button>
            </div>

            {activeStatus.state === "loading" ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Running action...
              </div>
            ) : null}

            {activeStatus.state === "error" ? (
              <p className="text-sm text-destructive">✕ {activeStatus.message}</p>
            ) : null}

            {activeStatus.state === "success" ? (
              <div className="space-y-2">{renderActionResult(activeAction, activeStatus.data)}</div>
            ) : null}
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Click any action to run it and inspect full results below.
        </p>
      </CardContent>
    </Card>
  );
}
