import { NextResponse } from "next/server";
import { getRuns } from "@/lib/data";

export async function GET() {
  const runs = await getRuns();
  return NextResponse.json({ runs });
}
