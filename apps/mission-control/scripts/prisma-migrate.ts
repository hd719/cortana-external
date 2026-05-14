import { spawnSync } from "node:child_process";

import { loadMissionControlScriptEnv } from "../lib/script-env";

const migrateArgs = process.argv.slice(2);

if (migrateArgs.length === 0) {
  console.error("Usage: tsx scripts/prisma-migrate.ts <prisma migrate args>");
  process.exit(1);
}

const env = loadMissionControlScriptEnv(process.cwd(), { ...process.env });
const result = spawnSync("pnpm", ["exec", "prisma", "migrate", ...migrateArgs], {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
