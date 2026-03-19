import fs from "node:fs";
import path from "node:path";

import { readJsonFile, writeJsonFileAtomic } from "../lib/files.js";

export async function ensureDataDir(dataDir: string): Promise<void> {
  await fs.promises.mkdir(dataDir, { recursive: true });
}

export async function saveLatestPayload(dataDir: string, data: unknown): Promise<void> {
  const filePath = path.join(dataDir, "latest.json");
  await writeJsonFileAtomic(filePath, data);
}

export async function appendToHistory(dataDir: string, data: unknown): Promise<void> {
  const filePath = path.join(dataDir, "history.ndjson");
  await fs.promises.appendFile(filePath, `${JSON.stringify(data)}\n`);
}

export async function loadLatestPayload<T = unknown>(dataDir: string): Promise<T> {
  const filePath = path.join(dataDir, "latest.json");
  return readJsonFile<T>(filePath);
}
