import { NextResponse } from "next/server";
import { runCouncilDeliberationFanout } from "@/lib/council-jobs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: Request) {
  const expectedToken = process.env.MISSION_CONTROL_CRON_TOKEN;
  if (expectedToken) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${expectedToken}`) return unauthorized();
  }

  const body = (await request.json()) as { sessionId?: string };
  if (!body.sessionId) {
    return NextResponse.json({ error: "Missing required field: sessionId" }, { status: 400 });
  }

  const result = await runCouncilDeliberationFanout(body.sessionId);

  return NextResponse.json({ ok: true, result }, {
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
