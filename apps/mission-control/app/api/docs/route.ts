import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getDocsPath } from "@/lib/runtime-paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DocEntry = { name: string; path: string };

type DocsListResponse =
  | { status: "ok"; files: DocEntry[] }
  | { status: "error"; message: string };

type DocContentResponse =
  | { status: "ok"; name: string; content: string }
  | { status: "error"; message: string };

const isValidDocName = (value: string) => {
  if (!value.endsWith(".md")) return false;
  const base = path.basename(value);
  if (base !== value) return false;
  if (base.length <= 3) return false;
  return true;
};

async function listDocs(docsRoot: string): Promise<DocEntry[]> {
  const entries = await fs.readdir(docsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => ({ name: entry.name, path: path.join(docsRoot, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const file = searchParams.get("file");
  const docsRoot = getDocsPath();

  if (!file) {
    try {
      const files = await listDocs(docsRoot);
      const payload: DocsListResponse = { status: "ok", files };
      return NextResponse.json(payload, {
        headers: {
          "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      });
    } catch (error) {
      const payload: DocsListResponse = {
        status: "error",
        message: error instanceof Error ? error.message : "Failed to load docs.",
      };
      return NextResponse.json(payload, { status: 500 });
    }
  }

  if (!isValidDocName(file)) {
    const payload: DocContentResponse = {
      status: "error",
      message: "Invalid file name.",
    };
    return NextResponse.json(payload, { status: 400 });
  }

  try {
    const filePath = path.join(docsRoot, file);
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      const payload: DocContentResponse = {
        status: "error",
        message: "File not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const content = await fs.readFile(filePath, "utf8");
    const payload: DocContentResponse = { status: "ok", name: file, content };
    return NextResponse.json(payload, {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const status = code === "ENOENT" ? 404 : 500;
    const payload: DocContentResponse = {
      status: "error",
      message: code === "ENOENT" ? "File not found." : "Failed to load doc.",
    };
    return NextResponse.json(payload, { status });
  }
}
