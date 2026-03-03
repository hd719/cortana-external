import fs from "fs/promises";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const filePath = path.join(os.homedir(), "openclaw", "MEMORY.md");

  try {
    const [content, stats] = await Promise.all([fs.readFile(filePath, "utf8"), fs.stat(filePath)]);
    return NextResponse.json({ content, updatedAt: stats.mtime.toISOString() });
  } catch (error) {
    return NextResponse.json(
      { content: "", updatedAt: null, error: error instanceof Error ? error.message : "Failed to read MEMORY.md" },
      { status: 500 }
    );
  }
}
