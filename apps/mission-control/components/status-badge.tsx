import { VariantProps } from "class-variance-authority";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { AgentStatus, RunStatus, Severity } from "@prisma/client";

type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

type StatusBadgeProps = {
  value: AgentStatus | RunStatus | Severity | string;
  variant?: "agent" | "run" | "severity" | "default";
};

const agentMap: Record<AgentStatus, BadgeVariant> = {
  active: "success",
  idle: "secondary",
  degraded: "warning",
  offline: "outline",
};

const runMap: Record<RunStatus, BadgeVariant> = {
  queued: "secondary",
  running: "success",
  completed: "success",
  failed: "destructive",
  cancelled: "outline",
};

const severityMap: Record<Severity, BadgeVariant> = {
  info: "secondary",
  warning: "warning",
  critical: "destructive",
};

export function StatusBadge({ value, variant = "default" }: StatusBadgeProps) {
  const normalized = String(value).toLowerCase();
  const label = normalized.replace(/_/g, " ");

  let badgeVariant: BadgeVariant = "secondary";

  if (variant === "agent" && Object.hasOwn(agentMap, normalized)) {
    badgeVariant = agentMap[normalized as AgentStatus];
  } else if (variant === "run" && Object.hasOwn(runMap, normalized)) {
    badgeVariant = runMap[normalized as RunStatus];
  } else if (variant === "severity" && Object.hasOwn(severityMap, normalized)) {
    badgeVariant = severityMap[normalized as Severity];
  }

  return (
    <Badge variant={badgeVariant} className="capitalize">
      {label}
    </Badge>
  );
}
