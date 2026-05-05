import { Dirent } from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATE_FILE_REGEX = /^\d{4}-\d{2}-\d{2}\.md$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

type MemoryFile = {
  date: string;
  path: string;
};

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

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

function getMemoryRoots() {
  const home = os.homedir();
  const runtimeDailyRoot =
    process.env.OPENCLAW_DAILY_MEMORY_DIR ?? path.join(home, ".openclaw", "memory", "daily");
  const runtimeMemoryRoot = process.env.OPENCLAW_MEMORY_DIR ?? path.join(home, ".openclaw", "memory");
  const legacyMemoryRoot = process.env.OPENCLAW_LEGACY_MEMORY_DIR ?? path.join(home, "openclaw", "memory");

  return {
    dailyRoots: uniquePaths([runtimeDailyRoot, legacyMemoryRoot]),
    archiveRoots: uniquePaths([
      path.join(runtimeDailyRoot, "archive"),
      path.join(runtimeMemoryRoot, "archive"),
      path.join(legacyMemoryRoot, "archive"),
    ]),
  };
}

async function readDatedFiles(root: string): Promise<MemoryFile[]> {
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && DATE_FILE_REGEX.test(entry.name))
    .map((entry) => ({
      date: path.basename(entry.name, ".md"),
      path: path.join(root, entry.name),
    }));
}

async function getMemoryFiles() {
  const { dailyRoots, archiveRoots } = getMemoryRoots();

  const dailyFiles = (await Promise.all(dailyRoots.map((root) => readDatedFiles(root)))).flat();

  const archiveFiles = (
    await Promise.all(
      archiveRoots.map(async (root) =>
        (await walkArchive(root)).map((filePath) => ({
          date: path.basename(filePath, ".md"),
          path: filePath,
        }))
      )
    )
  ).flat();

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
      new Set(allFiles.map((file) => file.date))
    ).sort((a, b) => b.localeCompare(a));

    if (!date) {
      return NextResponse.json({ dates });
    }

    let content: string | undefined;
    const match = allFiles.find((file) => file.date === date);

    if (match) {
      content = await fs.readFile(match.path, "utf8");
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
