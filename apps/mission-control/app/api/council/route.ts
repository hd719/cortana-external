import { NextResponse } from "next/server";
import { CouncilFilters, createCouncilSession, getCouncilSessions } from "@/lib/council";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const parseNumber = (value: string | null) => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const filters: CouncilFilters = {
    status: searchParams.get("status") ?? undefined,
    mode: searchParams.get("mode") ?? undefined,
    rangeHours: parseNumber(searchParams.get("rangeHours")) ?? 168,
    limit: parseNumber(searchParams.get("limit")) ?? 120,
  };

  const sessions = await getCouncilSessions(filters);

  return NextResponse.json({ sessions }, {
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    taskId?: string | null;
    topic?: string;
    objective?: string | null;
    mode?: string;
    createdBy?: string | null;
  };

  if (!body.topic || !body.mode) {
    return NextResponse.json({ error: "Missing required fields: topic, mode" }, { status: 400 });
  }

  const session = await createCouncilSession({
    taskId: body.taskId,
    topic: body.topic,
    objective: body.objective,
    mode: body.mode,
    createdBy: body.createdBy,
  });

  return NextResponse.json({ session }, {
    status: 201,
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
