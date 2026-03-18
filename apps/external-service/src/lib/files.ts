import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const writeLocks = new Map<string, Promise<void>>();
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.promises.readFile(resolveFromCwd(filePath), "utf-8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFileAtomic(filePath: string, data: unknown, mode = 0o600): Promise<void> {
  const resolvedPath = resolveFromCwd(filePath);
  const previous = writeLocks.get(resolvedPath) ?? Promise.resolve();
  const next = previous.then(async () => {
    const directory = path.dirname(resolvedPath);
    const base = path.basename(resolvedPath);
    const tempPath = path.join(directory, `${base}.tmp-${process.pid}-${Date.now()}`);
    const payload = `${JSON.stringify(data, null, 2)}\n`;

    await fs.promises.mkdir(directory, { recursive: true });

    try {
      const handle = await fs.promises.open(tempPath, "w", mode);
      await handle.writeFile(payload);
      await handle.sync();
      await handle.close();
      await fs.promises.chmod(tempPath, mode);
      await fs.promises.rename(tempPath, resolvedPath);

      const dirHandle = await fs.promises.open(directory, "r");
      await dirHandle.sync();
      await dirHandle.close();
    } catch (error) {
      await fs.promises.rm(tempPath, { force: true });
      throw error;
    }
  });

  writeLocks.set(resolvedPath, next.catch(() => {}));
  await next;
}

export async function writeJsonFile(filePath: string, data: unknown, mode = 0o644): Promise<void> {
  const resolvedPath = resolveFromCwd(filePath);
  await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.promises.writeFile(resolvedPath, `${JSON.stringify(data, null, 2)}\n`, { mode });
}

export function resolveFromCwd(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  return path.resolve(repoRoot, filePath);
}
