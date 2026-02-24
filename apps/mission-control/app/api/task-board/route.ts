import { NextResponse } from "next/server";
import { getTaskBoard } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getTaskBoard();
  return NextResponse.json(data);
}
