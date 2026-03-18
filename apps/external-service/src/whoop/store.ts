import { readJsonFile, writeJsonFile, writeJsonFileAtomic } from "../lib/files.js";
import { isZeroOrInvalidDate, parseDate, toIsoString } from "../lib/time.js";
import type { WhoopData, WhoopTokenData } from "./types.js";

export interface NormalizedWhoopToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
  lastRefreshAt: Date | null;
}

export async function loadWhoopTokens(tokenPath: string): Promise<NormalizedWhoopToken> {
  const payload = await readJsonFile<WhoopTokenData>(tokenPath);
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? "",
    expiresAt: parseDate(payload.expires_at),
    lastRefreshAt: parseDate(payload.last_refresh_at),
  };
}

export async function saveWhoopTokens(tokenPath: string, token: NormalizedWhoopToken): Promise<void> {
  const payload: WhoopTokenData = {
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expires_at: token.expiresAt ? toIsoString(token.expiresAt) : new Date(0).toISOString(),
  };
  if (token.lastRefreshAt && !isZeroOrInvalidDate(token.lastRefreshAt)) {
    payload.last_refresh_at = toIsoString(token.lastRefreshAt);
  }
  await writeJsonFileAtomic(tokenPath, payload, 0o600);
}

export async function loadWhoopData(dataPath: string): Promise<WhoopData> {
  return readJsonFile<WhoopData>(dataPath);
}

export async function saveWhoopData(dataPath: string, data: WhoopData): Promise<void> {
  await writeJsonFile(dataPath, data, 0o600);
}
