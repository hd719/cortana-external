import { getAutonomyOpsSnapshot } from "@/lib/autonomy-ops";
import { listHumanRequiredActions, type HumanRequiredAction } from "@/lib/human-required-actions";
import { AutonomyClient } from "./autonomy-client";

export const dynamic = "force-dynamic";

export default function AutonomyPage() {
  const snapshot = getAutonomyOpsSnapshot();
  let humanActions: HumanRequiredAction[] = [];
  let humanActionsError: string | null = null;
  try {
    humanActions = listHumanRequiredActions();
  } catch (error) {
    humanActionsError = error instanceof Error ? error.message : String(error);
  }
  return <AutonomyClient initialSnapshot={snapshot} initialHumanActions={humanActions} initialHumanActionsError={humanActionsError} />;
}
