import { VariantProps } from "class-variance-authority";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { AgentStatus, Severity } from "@prisma/client";

type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

type StatusBadgeProps = {
  value: AgentStatus | Severity | string;
  variant?: "agent" | "run" | "severity" | "task" | "default";
};

const agentMap: Record<AgentStatus, BadgeVariant> = {
  active: "success",
  idle: "secondary",
  degraded: "warning",
  offline: "outline",
};

const runMap: Record<string, BadgeVariant> = {
  done: "success",
  completed: "success",
  failed: "destructive",
  timeout: "warning",
  running: "info",
  queued: "secondary",
  cancelled: "outline",
  killed: "outline",
};

const severityMap: Record<Severity, BadgeVariant> = {
  info: "secondary",
  warning: "warning",
  critical: "destructive",
};

const taskMap: Record<string, BadgeVariant> = {
  pending: "secondary",
  in_progress: "warning",
  blocked: "warning",
  done: "success",
  completed: "success",
  cancelled: "outline",
  failed: "destructive",
};

export function StatusBadge({ value, variant = "default" }: StatusBadgeProps) {
  const normalized = String(value).toLowerCase();
  const label = normalized.replace(/_/g, " ");

  let badgeVariant: BadgeVariant = "secondary";

  if (variant === "agent" && Object.hasOwn(agentMap, normalized)) {
    badgeVariant = agentMap[normalized as AgentStatus];
  } else if (variant === "run" && Object.hasOwn(runMap, normalized)) {
    badgeVariant = runMap[normalized];
  } else if (variant === "severity" && Object.hasOwn(severityMap, normalized)) {
    badgeVariant = severityMap[normalized as Severity];
  } else if (variant === "task" && Object.hasOwn(taskMap, normalized)) {
    badgeVariant = taskMap[normalized];
  }

  return (
    <Badge variant={badgeVariant} className="capitalize">
      {label}
    </Badge>
  );
}
