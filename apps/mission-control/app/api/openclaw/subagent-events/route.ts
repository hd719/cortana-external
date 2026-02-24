import { NextResponse } from "next/server";
import {
  ingestOpenClawLifecycleEvent,
  OpenClawLifecycleEvent,
} from "@/lib/openclaw-bridge";

export const dynamic = "force-dynamic";

type IncomingPayload = OpenClawLifecycleEvent | OpenClawLifecycleEvent[];

export async function POST(request: Request) {
  const token = process.env.OPENCLAW_EVENT_TOKEN;
  if (token) {
    const auth = request.headers.get("authorization") || "";
    if (auth !== `Bearer ${token}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = (await request.json()) as IncomingPayload;
  const events = Array.isArray(body) ? body : [body];

  if (events.length === 0) {
    return NextResponse.json({ error: "No events provided" }, { status: 400 });
  }

  for (const event of events) {
    if (!event.runId || !event.status) {
      return NextResponse.json(
        { error: "Each event requires runId and status" },
        { status: 400 }
      );
    }
  }

  const runs = await Promise.all(events.map((event) => ingestOpenClawLifecycleEvent(event)));

  return NextResponse.json({ ok: true, upserted: runs.length, runs });
}
