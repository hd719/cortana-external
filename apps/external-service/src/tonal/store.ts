import { readJsonFile, writeJsonFile, writeJsonFileAtomic } from "../lib/files.js";
import { parseDate, toIsoString } from "../lib/time.js";
import type { TonalCacheData, TonalTokenData } from "./types.js";

export interface ParsedTonalToken {
  idToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface ParsedTonalCache {
  userId: string;
  profile: Record<string, unknown>;
  workouts: Record<string, Record<string, unknown>>;
  strengthScores: TonalCacheData["strength_scores"];
  lastUpdated: Date;
}

export async function loadTokens(path: string): Promise<ParsedTonalToken> {
  const raw = await readJsonFile<TonalTokenData>(path);
  const expiresAt = parseDate(raw.expires_at);
  if (!expiresAt) {
    throw new Error("invalid tonal token expiry");
  }

  return {
    idToken: raw.id_token,
    refreshToken: raw.refresh_token ?? "",
    expiresAt,
  };
}

export async function saveTokens(path: string, tokens: ParsedTonalToken): Promise<void> {
  await writeJsonFileAtomic(
    path,
    {
      id_token: tokens.idToken,
      refresh_token: tokens.refreshToken || undefined,
      expires_at: toIsoString(tokens.expiresAt),
    } satisfies TonalTokenData,
    0o600,
  );
}

export async function loadCache(path: string): Promise<ParsedTonalCache> {
  const raw = await readJsonFile<TonalCacheData>(path);
  const lastUpdated = parseDate(raw.last_updated);
  if (!lastUpdated) {
    throw new Error("invalid tonal cache timestamp");
  }

  return {
    userId: raw.user_id ?? "",
    profile: raw.profile ?? {},
    workouts: raw.workouts ?? {},
    strengthScores: raw.strength_scores ?? null,
    lastUpdated,
  };
}

export async function saveCache(path: string, cache: ParsedTonalCache): Promise<void> {
  await writeJsonFile(
    path,
    {
      user_id: cache.userId,
      profile: cache.profile ?? {},
      workouts: cache.workouts ?? {},
      strength_scores: cache.strengthScores ?? null,
      last_updated: toIsoString(cache.lastUpdated),
    } satisfies TonalCacheData,
    0o644,
  );
}
