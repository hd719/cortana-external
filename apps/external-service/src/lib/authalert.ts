import os from "node:os";
import path from "node:path";

import { writeJsonFileAtomic } from "./files.js";

const threshold = 3;
const failures = new Map<string, number>();

export async function markFailure(provider: string, error?: unknown): Promise<void> {
  const count = (failures.get(provider) ?? 0) + 1;
  failures.set(provider, count);
  if (count < threshold) {
    return;
  }

  await writeJsonFileAtomic(
    path.join(os.homedir(), ".cortana", "auth-alerts", `${provider}.json`),
    {
      provider,
      consecutive_failures: count,
      last_error: error instanceof Error ? error.message : error ? String(error) : "",
      updated_at: new Date().toISOString(),
    },
    0o600,
  );
}

export function markSuccess(provider: string): void {
  failures.set(provider, 0);
}

export function resetAuthAlertsForTests(): void {
  failures.clear();
}
