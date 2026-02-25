"use client";

import { useMemo, useState, type ComponentType } from "react";
import { Loader2, Play, RefreshCcw, Wallet, HeartPulse } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type ActionKey = "chaos-test" | "reflection-sweep" | "check-budget" | "force-heartbeat";

type ActionStatus = {
  state: "idle" | "loading" | "success" | "error";
  message?: string;
};

const ACTIONS: Array<{ key: ActionKey; label: string; icon: ComponentType<{ className?: string }> }> = [
  { key: "chaos-test", label: "Run Chaos Test", icon: Play },
  { key: "reflection-sweep", label: "Trigger Reflection Sweep", icon: RefreshCcw },
  { key: "check-budget", label: "Check Budget", icon: Wallet },
  { key: "force-heartbeat", label: "Force Heartbeat", icon: HeartPulse },
];

export function QuickActionsCard() {
  const [statuses, setStatuses] = useState<Record<ActionKey, ActionStatus>>({
    "chaos-test": { state: "idle" },
    "reflection-sweep": { state: "idle" },
    "check-budget": { state: "idle" },
    "force-heartbeat": { state: "idle" },
  });

  const anyRunning = useMemo(
    () => Object.values(statuses).some((s) => s.state === "loading"),
    [statuses]
  );

  const runAction = async (action: ActionKey) => {
    setStatuses((prev) => ({
      ...prev,
      [action]: { state: "loading" },
    }));

    try {
      const response = await fetch(`/api/actions/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });

      const payload = (await response.json()) as { ok?: boolean; message?: string };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Action failed");
      }

      setStatuses((prev) => ({
        ...prev,
        [action]: {
          state: "success",
          message: payload.message || "Action completed",
        },
      }));
    } catch (error) {
      setStatuses((prev) => ({
        ...prev,
        [action]: {
          state: "error",
          message: error instanceof Error ? error.message : "Action failed",
        },
      }));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                  className="w-full justify-start border-border/70 bg-background/60"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                  {action.label}
                </Button>

                {status.state === "success" ? (
                  <p className="mt-2 text-xs text-emerald-300">✓ {status.message}</p>
                ) : null}
                {status.state === "error" ? (
                  <p className="mt-2 text-xs text-destructive">✕ {status.message}</p>
                ) : null}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          {anyRunning ? "Running action…" : "Actions call stub API endpoints for now."}
        </p>
      </CardContent>
    </Card>
  );
}
