import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempRoots: string[] = [];
const originalEnv = {
  OPENCLAW_DAILY_MEMORY_DIR: process.env.OPENCLAW_DAILY_MEMORY_DIR,
  OPENCLAW_MEMORY_DIR: process.env.OPENCLAW_MEMORY_DIR,
  OPENCLAW_LEGACY_MEMORY_DIR: process.env.OPENCLAW_LEGACY_MEMORY_DIR,
};

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mission-control-memories-"));
  tempRoots.push(root);
  return root;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function restoreEnv(key: keyof typeof originalEnv): void {
  const value = originalEnv[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

afterEach(() => {
  restoreEnv("OPENCLAW_DAILY_MEMORY_DIR");
  restoreEnv("OPENCLAW_MEMORY_DIR");
  restoreEnv("OPENCLAW_LEGACY_MEMORY_DIR");

  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("GET /api/memories", () => {
  it("lists runtime daily memory before legacy repo memory and reads the runtime copy", async () => {
    const root = makeTempRoot();
    const dailyRoot = path.join(root, ".openclaw", "memory", "daily");
    const memoryRoot = path.join(root, ".openclaw", "memory");
    const legacyRoot = path.join(root, "openclaw", "memory");

    process.env.OPENCLAW_DAILY_MEMORY_DIR = dailyRoot;
    process.env.OPENCLAW_MEMORY_DIR = memoryRoot;
    process.env.OPENCLAW_LEGACY_MEMORY_DIR = legacyRoot;

    writeFile(path.join(legacyRoot, "2026-05-05.md"), "legacy May 5");
    writeFile(path.join(dailyRoot, "2026-05-05.md"), "runtime May 5");
    writeFile(path.join(legacyRoot, "2026-05-04.md"), "legacy May 4");

    const { GET } = await import("@/app/api/memories/route");

    const listResponse = await GET(new Request("http://localhost/api/memories"));
    await expect(listResponse.json()).resolves.toEqual({
      dates: ["2026-05-05", "2026-05-04"],
    });

    const dateResponse = await GET(new Request("http://localhost/api/memories?date=2026-05-05"));
    await expect(dateResponse.json()).resolves.toEqual({
      dates: ["2026-05-05", "2026-05-04"],
      content: "runtime May 5",
    });
  });

  it("falls back to runtime archive files", async () => {
    const root = makeTempRoot();
    const dailyRoot = path.join(root, ".openclaw", "memory", "daily");
    const memoryRoot = path.join(root, ".openclaw", "memory");
    const legacyRoot = path.join(root, "openclaw", "memory");

    process.env.OPENCLAW_DAILY_MEMORY_DIR = dailyRoot;
    process.env.OPENCLAW_MEMORY_DIR = memoryRoot;
    process.env.OPENCLAW_LEGACY_MEMORY_DIR = legacyRoot;

    writeFile(path.join(memoryRoot, "archive", "2026", "05", "2026-05-03.md"), "archived May 3");

    const { GET } = await import("@/app/api/memories/route");

    const response = await GET(new Request("http://localhost/api/memories?date=2026-05-03"));
    await expect(response.json()).resolves.toEqual({
      dates: ["2026-05-03"],
      content: "archived May 3",
    });
  });
});
