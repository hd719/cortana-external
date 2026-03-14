import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

import { DEFAULT_REGIME_PATH } from "./paths.js";
import type { RegimeContext } from "./types.js";

export async function loadRegimeContext(
  input?: string | Partial<RegimeContext> | null,
): Promise<RegimeContext | null> {
  if (!input) {
    return loadRegimeContextFromFile(DEFAULT_REGIME_PATH);
  }

  if (typeof input !== "string") {
    return normalizeRegimeContext(input);
  }

  if (input.trim().startsWith("{")) {
    return normalizeRegimeContext(JSON.parse(input) as Partial<RegimeContext>);
  }

  return loadRegimeContextFromFile(input);
}

async function loadRegimeContextFromFile(path: string): Promise<RegimeContext | null> {
  try {
    await access(path, constants.R_OK);
  } catch {
    return null;
  }

  const raw = JSON.parse(await readFile(path, "utf8")) as {
    generated_at_utc?: string;
    market_status?: {
      regime?: string;
      status?: "ok" | "degraded";
      position_sizing?: number;
      notes?: string;
      regime_score?: number;
      drawdown_pct?: number;
      recent_return_pct?: number;
    };
  };

  const status = raw.market_status;
  if (!status?.regime) {
    return null;
  }

  return normalizeRegimeContext({
    source: path,
    asOf: raw.generated_at_utc ?? null,
    regime: status.regime as RegimeContext["regime"],
    status: status.status ?? "ok",
    positionSizing: status.position_sizing ?? 0,
    notes: status.notes ?? "",
    regimeScore: status.regime_score ?? 0,
    drawdownPct: status.drawdown_pct ?? 0,
    recentReturnPct: status.recent_return_pct ?? 0,
  });
}

function normalizeRegimeContext(
  input: Partial<RegimeContext>,
): RegimeContext | null {
  if (!input.regime) {
    return null;
  }

  return {
    source: input.source ?? "inline",
    asOf: input.asOf ?? null,
    regime: input.regime,
    status: input.status ?? "ok",
    positionSizing: input.positionSizing ?? 0,
    notes: input.notes ?? "",
    regimeScore: input.regimeScore ?? 0,
    drawdownPct: input.drawdownPct ?? 0,
    recentReturnPct: input.recentReturnPct ?? 0,
  };
}
