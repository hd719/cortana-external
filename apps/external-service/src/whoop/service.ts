import { markFailure, markSuccess } from "../lib/authalert.js";
import { createLogger } from "../lib/logger.js";
import { isZeroOrInvalidDate } from "../lib/time.js";
import { loadWhoopData, loadWhoopTokens, saveWhoopData, saveWhoopTokens, type NormalizedWhoopToken } from "./store.js";
import type { WhoopCollectionResponse, WhoopData, WhoopServiceOptions, WhoopTokenResponse } from "./types.js";

const WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const WHOOP_API_BASE = "https://api.prod.whoop.com/developer";
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 10 * 60 * 1000;

type RefreshResult = {
  token: NormalizedWhoopToken;
};

export class WhoopService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUrl: string;
  private readonly tokenPath: string;
  private readonly dataPath: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger = createLogger("whoop");

  private cachedData: WhoopData | null = null;
  private cacheFetchedAt = 0;
  private refreshInFlight: Promise<RefreshResult> | null = null;

  constructor(options: WhoopServiceOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.redirectUrl = options.redirectUrl;
    this.tokenPath = options.tokenPath;
    this.dataPath = options.dataPath;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  getAuthUrl(): string {
    const params = new URLSearchParams();
    params.set("client_id", this.clientId);
    params.set("redirect_uri", this.redirectUrl);
    params.set("response_type", "code");
    params.set("scope", "read:profile read:body_measurement read:cycles read:recovery read:sleep read:workout offline");
    params.set("state", "whoopauth");
    return `${WHOOP_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<void> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUrl,
    });

    const response = await this.fetchImpl(WHOOP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (response.status >= 400) {
      const responseBody = (await response.text()).slice(0, 2048);
      throw new Error(`token endpoint returned status ${response.status}: ${responseBody.trim()}`);
    }

    const token = (await response.json()) as WhoopTokenResponse;
    const now = new Date();
    await saveWhoopTokens(this.tokenPath, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? "",
      expiresAt: new Date(now.getTime() + Math.max(0, token.expires_in) * 1000),
      lastRefreshAt: now,
    });
  }

  async getAuthStatus(): Promise<Record<string, unknown>> {
    try {
      const tokens = await loadWhoopTokens(this.tokenPath);
      const now = new Date();
      const expiresAt = tokens.expiresAt;
      const expiresInSeconds = expiresAt && !isZeroOrInvalidDate(expiresAt) ? Math.trunc((expiresAt.getTime() - now.getTime()) / 1000) : 0;

      return {
        has_token: true,
        token_path: this.tokenPath,
        expires_at: expiresAt ? expiresAt.toISOString() : null,
        expires_in_seconds: expiresInSeconds,
        is_expired: expiresAt ? now.getTime() > expiresAt.getTime() : false,
        needs_refresh: this.tokenNeedsRefresh(tokens),
        last_refresh_at: tokens.lastRefreshAt ? tokens.lastRefreshAt.toISOString() : null,
        refresh_token_present: tokens.refreshToken !== "",
      };
    } catch (error) {
      return {
        has_token: false,
        token_path: this.tokenPath,
        error: error instanceof Error ? error.message : String(error),
        refresh_token_present: false,
      };
    }
  }

  async getHealth(): Promise<Record<string, unknown>> {
    try {
      const tokens = await loadWhoopTokens(this.tokenPath);
      const now = new Date();
      const expiresAt = tokens.expiresAt;
      const expiresInSeconds =
        expiresAt && !isZeroOrInvalidDate(expiresAt) ? Math.trunc((expiresAt.getTime() - now.getTime()) / 1000) : 0;

      return {
        status: "ok",
        authenticated: true,
        token_path: this.tokenPath,
        expires_at: expiresAt ? expiresAt.toISOString() : null,
        expires_in_seconds: expiresInSeconds,
        is_expired: expiresAt ? now.getTime() > expiresAt.getTime() : false,
        needs_refresh: this.tokenNeedsRefresh(tokens),
        refresh_token_present: tokens.refreshToken !== "",
      };
    } catch (error) {
      return {
        status: "ok",
        authenticated: false,
        token_path: this.tokenPath,
        refresh_token_present: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getAggregateHealth(): Promise<Record<string, unknown>> {
    try {
      const tokens = await loadWhoopTokens(this.tokenPath);
      try {
        await this.proactiveRefreshIfExpiring(0);
      } catch (error) {
        return {
          status: "unhealthy",
          authenticated: true,
          error: error instanceof Error ? error.message : String(error),
          expires_at: tokens.expiresAt ? tokens.expiresAt.toISOString() : null,
          refresh_token_present: tokens.refreshToken !== "",
        };
      }

      const now = new Date();
      return {
        status: "healthy",
        authenticated: true,
        expires_at: tokens.expiresAt ? tokens.expiresAt.toISOString() : null,
        expires_in_seconds: tokens.expiresAt ? Math.trunc((tokens.expiresAt.getTime() - now.getTime()) / 1000) : 0,
        refresh_token_present: tokens.refreshToken !== "",
      };
    } catch (error) {
      return {
        status: "unhealthy",
        authenticated: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async warmup(): Promise<void> {
    const tokens = await loadWhoopTokens(this.tokenPath);
    await this.ensureValidToken(tokens);
  }

  async proactiveRefreshIfExpiring(withinMs: number): Promise<void> {
    const tokens = await loadWhoopTokens(this.tokenPath);
    if (tokens.expiresAt && !isZeroOrInvalidDate(tokens.expiresAt) && tokens.expiresAt.getTime() - Date.now() > withinMs) {
      return;
    }
    await this.ensureValidToken(tokens);
  }

  async getWhoopData(forceFresh: boolean): Promise<{ data: WhoopData; servedStale: boolean }> {
    if (!forceFresh && this.cachedData && Date.now() - this.cacheFetchedAt <= DEFAULT_CACHE_TTL_MS) {
      return { data: this.cachedData, servedStale: false };
    }

    let tokens: NormalizedWhoopToken;
    try {
      tokens = await loadWhoopTokens(this.tokenPath);
    } catch {
      throw Object.assign(new Error("not authenticated - visit /auth/url to authenticate"), { statusCode: 401 });
    }

    try {
      tokens = await this.ensureValidToken(tokens);
    } catch (error) {
      this.logger.error("token validation/refresh failed", error);
      try {
        const stale = await loadWhoopData(this.dataPath);
        this.cachedData = stale;
        this.cacheFetchedAt = Date.now();
        this.logger.log("serving stale Whoop cache from disk due to token refresh failure");
        return { data: stale, servedStale: true };
      } catch {
        throw Object.assign(new Error("token refresh failed"), { statusCode: 502 });
      }
    }

    try {
      const data = await this.fetchAllWhoopData(tokens.accessToken);
      this.cachedData = data;
      this.cacheFetchedAt = Date.now();
      await saveWhoopData(this.dataPath, data).catch((error) => this.logger.error("warning: failed to persist Whoop cache", error));
      return { data, servedStale: false };
    } catch (error) {
      this.logger.error("failed to fetch whoop data", error);
      throw Object.assign(new Error("failed to fetch whoop data"), { statusCode: 502 });
    }
  }

  private tokenNeedsRefresh(tokens: NormalizedWhoopToken | null): boolean {
    if (!tokens) return true;
    if (!tokens.expiresAt || isZeroOrInvalidDate(tokens.expiresAt)) return true;
    return Date.now() > tokens.expiresAt.getTime() - TOKEN_REFRESH_SKEW_MS;
  }

  private async ensureValidToken(tokens: NormalizedWhoopToken): Promise<NormalizedWhoopToken> {
    if (!this.tokenNeedsRefresh(tokens)) {
      markSuccess("whoop");
      return tokens;
    }

    if (!this.refreshInFlight) {
      this.refreshInFlight = this.performRefresh(tokens).finally(() => {
        this.refreshInFlight = null;
      });
    }

    try {
      const refreshed = await this.refreshInFlight;
      markSuccess("whoop");
      return refreshed.token;
    } catch (error) {
      await markFailure("whoop", error);
      throw error;
    }
  }

  private async performRefresh(tokens: NormalizedWhoopToken): Promise<RefreshResult> {
    let current = tokens;
    try {
      current = await loadWhoopTokens(this.tokenPath);
    } catch {
      current = tokens;
    }

    if (!this.tokenNeedsRefresh(current)) {
      return { token: current };
    }

    if (!current.refreshToken) {
      throw new Error("token expired and no refresh token available");
    }

    this.logger.printf("attempting token refresh (expires_at=%s)", current.expiresAt?.toISOString() ?? "");
    const refreshed = await this.refreshTokenWithRetry(current.refreshToken);
    const now = new Date();
    const next: NormalizedWhoopToken = {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token || current.refreshToken,
      expiresAt: refreshed.expires_in > 0 ? new Date(now.getTime() + refreshed.expires_in * 1000) : current.expiresAt,
      lastRefreshAt: now,
    };

    await saveWhoopTokens(this.tokenPath, next);
    this.logger.printf(
      "token refresh succeeded (new_expiry=%s, refresh_token_rotated=%t)",
      next.expiresAt?.toISOString() ?? "",
      Boolean(refreshed.refresh_token),
    );
    return { token: next };
  }

  private async refreshTokenWithRetry(refreshToken: string): Promise<WhoopTokenResponse> {
    const backoffs = [0, 2000, 5000];
    let lastError: unknown;
    for (let i = 0; i < backoffs.length; i += 1) {
      if (backoffs[i] > 0) {
        this.logger.printf("retrying Whoop token refresh in %s (attempt %d/%d)", `${backoffs[i]}ms`, i + 1, backoffs.length);
        await new Promise((resolve) => setTimeout(resolve, backoffs[i]));
      }

      try {
        return await this.refreshToken(refreshToken);
      } catch (error) {
        lastError = error;
        this.logger.printf("Whoop token refresh attempt %d/%d failed: %v", i + 1, backoffs.length, String(error));
        if (this.isNonRetriableRefreshError(error)) {
          throw error;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async refreshToken(refreshToken: string): Promise<WhoopTokenResponse> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const response = await this.fetchImpl(WHOOP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (response.status >= 400) {
      const text = (await response.text()).slice(0, 2048);
      throw new Error(`refresh token endpoint returned status ${response.status}: ${text.trim()}`);
    }

    return (await response.json()) as WhoopTokenResponse;
  }

  private isNonRetriableRefreshError(error: unknown): boolean {
    const text = String(error).toLowerCase();
    return text.includes("invalid_grant") || text.includes("invalid_client") || text.includes("unauthorized_client");
  }

  private async fetchAllWhoopData(accessToken: string): Promise<WhoopData> {
    const profile = await this.fetchWhoopObject(accessToken, "/v2/user/profile/basic");
    const body = await this.fetchWhoopObject(accessToken, "/v2/user/measurement/body");
    const cycles = await this.fetchWhoopCollection(accessToken, "/v2/cycle");
    const recovery = await this.fetchWhoopCollection(accessToken, "/v2/recovery");
    const sleep = await this.fetchWhoopCollection(accessToken, "/v2/activity/sleep");
    const workouts = await this.fetchWhoopCollection(accessToken, "/v2/activity/workout");
    return { profile, body_measurement: body, cycles, recovery, sleep, workouts };
  }

  private async fetchWhoopObject(accessToken: string, path: string): Promise<Record<string, unknown>> {
    const body = await this.fetchWhoop(accessToken, path, new URLSearchParams());
    return JSON.parse(body) as Record<string, unknown>;
  }

  private async fetchWhoopCollection(accessToken: string, path: string): Promise<Record<string, unknown>[]> {
    const pageLimit = 25;
    const maxPages = 5;
    const records: Record<string, unknown>[] = [];
    let nextToken = "";
    for (let page = 0; page < maxPages; page += 1) {
      const params = new URLSearchParams();
      params.set("limit", String(pageLimit));
      if (nextToken) {
        params.set("next_token", nextToken);
      }
      const body = await this.fetchWhoop(accessToken, path, params);
      const payload = JSON.parse(body) as WhoopCollectionResponse;
      records.push(...(payload.records ?? []));
      if (!payload.next_token) {
        break;
      }
      nextToken = payload.next_token;
    }
    return records;
  }

  private async fetchWhoop(accessToken: string, routePath: string, params: URLSearchParams): Promise<string> {
    const maxAttempts = 3;
    const backoffs = [1000, 2000, 4000];
    const endpoint = `${WHOOP_API_BASE}${routePath}${params.size ? `?${params.toString()}` : ""}`;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(endpoint, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        });
        if (response.status === 401) {
          throw new Error("whoop unauthorized");
        }
        if (response.status >= 400) {
          throw new Error(`whoop api error: ${response.status}`);
        }
        return await response.text();
      } catch (error) {
        lastError = error;
      }

      if (!this.isWhoopRetriableError(lastError) || attempt === maxAttempts) {
        break;
      }

      this.logger.printf("retrying Whoop API call %s (attempt %d/%d) after error: %v", routePath, attempt + 1, maxAttempts, String(lastError));
      await new Promise((resolve) => setTimeout(resolve, backoffs[attempt - 1]));
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private isWhoopRetriableError(error: unknown): boolean {
    const text = String(error);
    const match = text.match(/whoop api error:\s*(\d+)/i);
    if (!match) {
      return false;
    }

    const status = Number(match[1]);
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  }
}
