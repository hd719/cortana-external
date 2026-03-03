import { Dirent } from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATE_FILE_REGEX = /^\d{4}-\d{2}-\d{2}\.md$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

async function walkArchive(dir: string): Promise<string[]> {
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return walkArchive(fullPath);
      if (entry.isFile() && DATE_FILE_REGEX.test(entry.name)) return [fullPath];
      return [] as string[];
    })
  );

  return nested.flat();
}

async function getMemoryFiles() {
  const memoryRoot = path.join(os.homedir(), "openclaw", "memory");
  const archiveRoot = path.join(memoryRoot, "archive");

  let dailyEntries: Dirent[] = [];
  try {
    dailyEntries = await fs.readdir(memoryRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const dailyFiles = dailyEntries
    .filter((entry) => entry.isFile() && DATE_FILE_REGEX.test(entry.name))
    .map((entry) => path.join(memoryRoot, entry.name));

  const archiveFiles = await walkArchive(archiveRoot);

  return { dailyFiles, archiveFiles };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (date && !DATE_REGEX.test(date)) {
    return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
  }

  try {
    const { dailyFiles, archiveFiles } = await getMemoryFiles();
    const allFiles = [...dailyFiles, ...archiveFiles];

    const dates = Array.from(
      new Set(allFiles.map((filePath) => path.basename(filePath, ".md")))
    ).sort((a, b) => b.localeCompare(a));

    if (!date) {
      return NextResponse.json({ dates });
    }

    const dailyPath = path.join(os.homedir(), "openclaw", "memory", `${date}.md`);

    let content: string | undefined;

    try {
      content = await fs.readFile(dailyPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const archiveMatch = archiveFiles.find(
        (filePath) => path.basename(filePath, ".md") === date
      );
      if (archiveMatch) {
        content = await fs.readFile(archiveMatch, "utf8");
      }
    }

    return NextResponse.json(content ? { dates, content } : { dates });
  } catch (error) {
    return NextResponse.json(
      {
        dates: [],
        error: error instanceof Error ? error.message : "Failed to load memories.",
      },
      { status: 500 }
    );
  }
}
