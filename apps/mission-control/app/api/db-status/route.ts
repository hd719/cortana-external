import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { stat } from "node:fs/promises";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const LANCEDB_PATH = "/Users/hd/.openclaw/memory/lancedb/memories.lance";

export async function GET() {
  let postgres = false;
  let lancedb = false;

  try {
    await prisma.$queryRaw`SELECT 1`;
    postgres = true;
  } catch {}

  try {
    const s = await stat(LANCEDB_PATH);
    lancedb = s.isDirectory();
  } catch {}

  return NextResponse.json(
    { postgres, lancedb },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    }
  );
}
