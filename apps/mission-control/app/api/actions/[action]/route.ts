import { NextResponse } from "next/server";

type ActionKey = "chaos-test" | "reflection-sweep" | "check-budget" | "force-heartbeat";

const ACTION_MESSAGES: Record<ActionKey, string> = {
  "chaos-test": "Chaos test queued.",
  "reflection-sweep": "Reflection sweep triggered.",
  "check-budget": "Budget check started.",
  "force-heartbeat": "Heartbeat forced.",
};

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ action: string }> }
) {
  const { action } = await params;

  if (!(action in ACTION_MESSAGES)) {
    return NextResponse.json(
      { ok: false, message: `Unknown action: ${action}` },
      { status: 404 }
    );
  }

  const typedAction = action as ActionKey;

  return NextResponse.json({
    ok: true,
    message: ACTION_MESSAGES[typedAction],
    action: typedAction,
  });
}
