import { createLogger, type AppLogger } from "../lib/logger.js";
import { markFailure, markSuccess } from "../lib/authalert.js";
import { isAbortError } from "../lib/http.js";
import { loadCache, loadTokens, saveCache, saveTokens, type ParsedTonalCache, type ParsedTonalToken } from "./store.js";
import type { StrengthScoreData, TonalDataResponse, TonalHealthResponse } from "./types.js";

const TONAL_AUTH_URL = "https://tonal.auth0.com/oauth/token";
const TONAL_API_BASE = "https://api.tonal.com";
const TONAL_CLIENT_ID = "ERCyexW-xoVG_Yy3RDe-eV4xsOnRHP6L";
const WORKOUT_FETCH_LIMIT = 50;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

class TonalUnauthorizedError extends Error {
  constructor() {
    super("tonal unauthorized");
    this.name = "TonalUnauthorizedError";
  }
}

class TonalApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly status: string,
    readonly body: string,
  ) {
    super(`tonal api error: ${status} - ${body}`);
    this.name = "TonalApiError";
  }
}

interface TonalAuthResponse {
  id_token: string;
  refresh_token?: string;
  expires_in: number;
}

interface ServiceOptions {
  email: string;
  password: string;
  tokenPath: string;
  dataPath: string;
  requestDelayMs?: number;
  logger?: AppLogger;
  fetchImpl?: typeof fetch;
}

interface CachedSnapshot {
  data: TonalDataResponse;
  updatedAtMs: number;
}

export class TonalService {
  private readonly email: string;
  private readonly password: string;
  private readonly tokenPath: string;
  private readonly dataPath: string;
  private readonly requestDelayMs: number;
  private readonly logger: AppLogger;
  private readonly fetchImpl: typeof fetch;
  private cache: CachedSnapshot | null = null;
  private mutationLock: Promise<void> = Promise.resolve();

  constructor(options: ServiceOptions) {
    this.email = options.email;
    this.password = options.password;
    this.tokenPath = options.tokenPath;
    this.dataPath = options.dataPath;
    this.requestDelayMs = options.requestDelayMs ?? 500;
    this.logger = options.logger ?? createLogger("tonal");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async handleHealth(request: Request): Promise<{ status: number; body: TonalHealthResponse }> {
    try {
      const token = await this.getValidToken(request.signal);
      const userId = await this.getUserInfo(request.signal, token);
      return { status: 200, body: { status: "healthy", user_id: userId } };
    } catch (error) {
      this.logger.printf("health check failed - auth error: %v", error instanceof Error ? error.message : String(error));
      return {
        status: 503,
        body: {
          status: "unhealthy",
          error: "authentication failed",
          details: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  async handleData(request: Request, forceFresh: boolean): Promise<{ status: number; body: unknown }> {
    if (!forceFresh && this.cache && Date.now() - this.cache.updatedAtMs <= DEFAULT_CACHE_TTL_MS) {
      return { status: 200, body: this.cache.data };
    }

    return this.withMutationLock(async () => {
      if (!forceFresh && this.cache && Date.now() - this.cache.updatedAtMs <= DEFAULT_CACHE_TTL_MS) {
        return { status: 200, body: this.cache.data };
      }

      let cache: ParsedTonalCache;
      try {
        cache = await loadCache(this.dataPath);
      } catch {
        cache = {
          userId: "",
          profile: {},
          workouts: {},
          strengthScores: null,
          lastUpdated: new Date(0),
        };
      }

      let userId = "";
      try {
        userId = await this.getUserInfoWithRetry(request.signal);
      } catch (error) {
        this.logger.printf("failed to get user info: %v", error instanceof Error ? error.message : String(error));
        return { status: 502, body: { error: "failed to get user info" } };
      }
      cache.userId = userId;

      try {
        await this.rateLimitDelay(request.signal);
      } catch {
        return { status: 499, body: { error: "client closed request" } };
      }

      let profile: Record<string, unknown> = {};
      try {
        profile = await this.getProfileWithRetry(request.signal, userId);
      } catch (error) {
        this.logger.printf("failed to get profile: %v", error instanceof Error ? error.message : String(error));
        return { status: 502, body: { error: "failed to get profile" } };
      }
      cache.profile = profile;

      try {
        await this.rateLimitDelay(request.signal);
      } catch {
        return { status: 499, body: { error: "client closed request" } };
      }

      let totalWorkouts = 0;
      const tw = profile.totalWorkouts;
      if (typeof tw === "number") {
        totalWorkouts = Math.trunc(tw);
      }

      let workouts: Array<Record<string, unknown>> = [];
      try {
        workouts = await this.getWorkoutActivitiesWithRetry(request.signal, userId, WORKOUT_FETCH_LIMIT, totalWorkouts);
      } catch (error) {
        this.logger.printf("failed to get workouts: %v", error instanceof Error ? error.message : String(error));
        return { status: 502, body: { error: "failed to get workouts" } };
      }
      for (const workout of workouts) {
        const raw = (workout as Record<string, unknown>).id;
        if (typeof raw !== "string" && typeof raw !== "number") {
          continue;
        }
        cache.workouts[String(raw)] = workout;
      }

      try {
        await this.rateLimitDelay(request.signal);
      } catch {
        return { status: 499, body: { error: "client closed request" } };
      }
      let current: Array<Record<string, unknown>> = [];
      try {
        current = await this.getStrengthScoresCurrentWithRetry(request.signal, userId);
      } catch (error) {
        this.logger.printf(
          "failed to get current strength scores: %v",
          error instanceof Error ? error.message : String(error),
        );
        return { status: 502, body: { error: "failed to get current strength scores" } };
      }

      try {
        await this.rateLimitDelay(request.signal);
      } catch {
        return { status: 499, body: { error: "client closed request" } };
      }
      let history: Array<Record<string, unknown>> = [];
      try {
        history = await this.getStrengthScoresHistoryWithRetry(request.signal, userId);
      } catch (error) {
        this.logger.printf(
          "failed to get strength score history: %v",
          error instanceof Error ? error.message : String(error),
        );
        return { status: 502, body: { error: "failed to get strength score history" } };
      }

      cache.strengthScores = { current, history };
      cache.lastUpdated = new Date();

      try {
        await saveCache(this.dataPath, cache);
      } catch (error) {
        this.logger.printf("warning: failed to save cache: %v", error instanceof Error ? error.message : String(error));
      }

      const response: TonalDataResponse = {
        profile: cache.profile,
        workouts: cache.workouts,
        workout_count: Object.keys(cache.workouts).length,
        strength_scores: cache.strengthScores,
        last_updated: cache.lastUpdated.toISOString(),
      };
      this.cache = { data: response, updatedAtMs: Date.now() };
      return { status: 200, body: response };
    });
  }

  async warmup(signal: AbortSignal): Promise<void> {
    await this.getValidToken(signal);
  }

  async proactiveRefreshIfExpiring(signal: AbortSignal, withinMs: number): Promise<void> {
    try {
      const tokens = await loadTokens(this.tokenPath);
      if (tokens.expiresAt.getTime() - Date.now() > withinMs) {
        return;
      }
    } catch {
      // Fall through to auth flow.
    }
    await this.getValidToken(signal);
  }

  async getAggregateHealth(signal: AbortSignal): Promise<Record<string, unknown>> {
    let tokens: ParsedTonalToken | null = null;
    let loadError: Error | null = null;
    try {
      tokens = await loadTokens(this.tokenPath);
    } catch (error) {
      loadError = error instanceof Error ? error : new Error(String(error));
    }

    try {
      await this.warmup(signal);
    } catch (error) {
      const body: Record<string, unknown> = {
        status: "unhealthy",
        error: error instanceof Error ? error.message : String(error),
      };
      if (!loadError && tokens) {
        body.expires_at = tokens.expiresAt.toISOString();
      }
      return body;
    }

    const body: Record<string, unknown> = { status: "healthy" };
    if (!loadError && tokens) {
      body.expires_at = tokens.expiresAt.toISOString();
      body.expires_in_seconds = Math.trunc((tokens.expiresAt.getTime() - Date.now()) / 1000);
    }
    return body;
  }

  private async withMutationLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.mutationLock;
    let release: () => void = () => {};
    this.mutationLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async rateLimitDelay(signal: AbortSignal): Promise<void> {
    if (this.requestDelayMs <= 0) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, this.requestDelayMs);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("request aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private canSelfHealWithCredentials(): boolean {
    return this.email.trim() !== "" && this.password.trim() !== "";
  }

  private isAuthFailureError(error: unknown): boolean {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return (
      message.includes("invalid_grant") ||
      message.includes("unauthorized") ||
      message.includes("forbidden") ||
      message.includes("invalid token") ||
      message.includes("token")
    );
  }

  private async getValidToken(signal: AbortSignal): Promise<string> {
    try {
      const tokens = await loadTokens(this.tokenPath);
      if (Date.now() < tokens.expiresAt.getTime() - 60_000) {
        markSuccess("tonal");
        return tokens.idToken;
      }

      if (tokens.refreshToken) {
        this.logger.log("refreshing Tonal token...");
        try {
          const refreshed = await this.refreshAuthentication(signal, tokens.refreshToken);
          await saveTokens(this.tokenPath, refreshed);
          markSuccess("tonal");
          return refreshed.idToken;
        } catch (refreshError) {
          this.logger.printf(
            "refresh token failed: %v",
            refreshError instanceof Error ? refreshError.message : String(refreshError),
          );
          if (this.isAuthFailureError(refreshError) || refreshError instanceof TonalUnauthorizedError) {
            await markFailure("tonal", refreshError);
          }
          if (this.canSelfHealWithCredentials() && this.isAuthFailureError(refreshError)) {
            this.logger.log("refresh failed with auth error, triggering Tonal token self-heal");
            try {
              return await this.forceReAuthenticate(signal);
            } catch (healError) {
              this.logger.printf(
                "tonal self-heal failed after refresh auth error: %v",
                healError instanceof Error ? healError.message : String(healError),
              );
            }
          }
        }
      }
    } catch {
      // Fall through to full auth.
    }

    this.logger.log("authenticating with Tonal (password)...");
    try {
      const tokens = await this.authenticate(signal);
      await saveTokens(this.tokenPath, tokens);
      markSuccess("tonal");
      return tokens.idToken;
    } catch (error) {
      if (this.isAuthFailureError(error) || error instanceof TonalUnauthorizedError) {
        await markFailure("tonal", error);
      }
      if (this.canSelfHealWithCredentials() && this.isAuthFailureError(error)) {
        this.logger.log("password auth returned auth error, triggering Tonal token self-heal");
        try {
          return await this.forceReAuthenticate(signal);
        } catch (healError) {
          this.logger.printf(
            "tonal self-heal failed after password auth error: %v",
            healError instanceof Error ? healError.message : String(healError),
          );
        }
      }
      throw new Error(`authentication failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async forceReAuthenticate(signal: AbortSignal): Promise<string> {
    if (!this.canSelfHealWithCredentials()) {
      throw new Error("cannot self-heal tonal auth without TONAL_EMAIL and TONAL_PASSWORD");
    }

    try {
      const fs = await import("node:fs/promises");
      await fs.rm(this.tokenPath, { force: true });
    } catch (error) {
      this.logger.printf("TONAL SELF-HEAL: warning - failed to delete token file: %v", error);
    }

    const tokens = await this.authenticate(signal);
    await saveTokens(this.tokenPath, tokens);
    markSuccess("tonal");
    return tokens.idToken;
  }

  private async authenticate(signal: AbortSignal): Promise<ParsedTonalToken> {
    const payload = {
      grant_type: "http://auth0.com/oauth/grant-type/password-realm",
      realm: "Username-Password-Authentication",
      client_id: TONAL_CLIENT_ID,
      username: this.email,
      password: this.password,
      scope: "openid offline_access",
      audience: "https://tonal.auth0.com/userinfo",
    };

    const response = await this.fetchImpl(TONAL_AUTH_URL, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.text();
    if (response.status >= 400) {
      throw new Error(`auth failed: ${response.status} ${response.statusText} - ${body}`);
    }

    const parsed = JSON.parse(body) as TonalAuthResponse;
    return this.authResponseToToken(parsed);
  }

  private async refreshAuthentication(signal: AbortSignal, refreshToken: string): Promise<ParsedTonalToken> {
    const payload = {
      grant_type: "refresh_token",
      client_id: TONAL_CLIENT_ID,
      refresh_token: refreshToken,
    };

    const response = await this.fetchImpl(TONAL_AUTH_URL, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.text();
    if (response.status >= 400) {
      throw new Error(`refresh auth failed: ${response.status} ${response.statusText} - ${body}`);
    }

    const parsed = JSON.parse(body) as TonalAuthResponse;
    return this.authResponseToToken({
      ...parsed,
      refresh_token: parsed.refresh_token || refreshToken,
    });
  }

  private authResponseToToken(auth: TonalAuthResponse): ParsedTonalToken {
    let expiresAt = new Date(Date.now() + auth.expires_in * 1000);
    try {
      const jwtExp = extractJwtExpiry(auth.id_token);
      if (jwtExp) {
        expiresAt = jwtExp;
      }
    } catch {
      expiresAt = new Date(Date.now() + Math.trunc((auth.expires_in / 2) * 1000));
    }

    return {
      idToken: auth.id_token,
      refreshToken: auth.refresh_token ?? "",
      expiresAt,
    };
  }

  private async fetchTonal(
    signal: AbortSignal,
    token: string,
    method: string,
    endpointPath: string,
    headers: Record<string, string> = {},
  ): Promise<string> {
    const response = await this.fetchImpl(`${TONAL_API_BASE}${endpointPath}`, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...headers,
      },
    });

    const body = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new TonalUnauthorizedError();
    }
    if (response.status >= 400) {
      throw new TonalApiError(response.status, `${response.status} ${response.statusText}`, body);
    }
    return body;
  }

  private async apiCallWithSelfHeal(
    signal: AbortSignal,
    operation: (signal: AbortSignal, token: string) => Promise<void>,
  ): Promise<void> {
    const backoffs = [200, 400, 800];
    let token = await this.getValidToken(signal);

    for (let attempt = 0; ; attempt++) {
      try {
        await operation(signal, token);
        markSuccess("tonal");
        return;
      } catch (error) {
        if (error instanceof TonalUnauthorizedError) {
          await markFailure("tonal", error);
          this.logger.log("TONAL SELF-HEAL: received 401/403, forcing token reset and re-authentication");
          try {
            await this.forceReAuthenticate(signal);
          } catch (healError) {
            await markFailure("tonal", healError);
            throw new Error(
              `tonal self-heal failed after unauthorized response: ${
                healError instanceof Error ? healError.message : String(healError)
              }`,
            );
          }

          token = await this.getValidToken(signal);
          try {
            await operation(signal, token);
          } catch (retryError) {
            if (retryError instanceof TonalUnauthorizedError) {
              await markFailure("tonal", retryError);
              throw new Error("retry also returned 401/403 after self-heal");
            }
            if (this.isAuthFailureError(retryError)) {
              await markFailure("tonal", retryError);
            }
            throw retryError;
          }

          markSuccess("tonal");
          this.logger.log("TONAL SELF-HEAL: recovery succeeded after token reset");
          return;
        }

        if (!isRetriableTonalError(error) || attempt >= backoffs.length) {
          if (this.isAuthFailureError(error)) {
            await markFailure("tonal", error);
          }
          throw error;
        }

        await sleep(backoffs[attempt] + Math.floor(Math.random() * 150), signal);
      }
    }
  }

  private async getUserInfo(signal: AbortSignal, token: string): Promise<string> {
    const body = await this.fetchTonal(signal, token, "GET", "/v6/users/userinfo");
    const parsed = JSON.parse(body) as { id?: string };
    if (!parsed.id) {
      throw new Error("user id missing");
    }
    return parsed.id;
  }

  private async getProfile(signal: AbortSignal, token: string, userId: string): Promise<Record<string, unknown>> {
    const body = await this.fetchTonal(signal, token, "GET", `/v6/users/${userId}/profile`);
    return JSON.parse(body) as Record<string, unknown>;
  }

  private async getWorkoutActivities(
    signal: AbortSignal,
    token: string,
    userId: string,
    limit: number,
    totalWorkouts: number,
  ): Promise<Array<Record<string, unknown>>> {
    const offset = totalWorkouts > limit ? totalWorkouts - limit : 0;
    const body = await this.fetchTonal(signal, token, "GET", `/v6/users/${userId}/workout-activities`, {
      "pg-offset": String(offset),
      "pg-limit": String(limit),
    });
    return JSON.parse(body) as Array<Record<string, unknown>>;
  }

  private async getStrengthScoresCurrent(
    signal: AbortSignal,
    token: string,
    userId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const body = await this.fetchTonal(signal, token, "GET", `/v6/users/${userId}/strength-scores/current`);
    return JSON.parse(body) as Array<Record<string, unknown>>;
  }

  private async getStrengthScoresHistory(
    signal: AbortSignal,
    token: string,
    userId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const body = await this.fetchTonal(signal, token, "GET", `/v6/users/${userId}/strength-scores/history`);
    return JSON.parse(body) as Array<Record<string, unknown>>;
  }

  private async getUserInfoWithRetry(signal: AbortSignal): Promise<string> {
    let result = "";
    await this.apiCallWithSelfHeal(signal, async (innerSignal, token) => {
      result = await this.getUserInfo(innerSignal, token);
    });
    return result;
  }

  private async getProfileWithRetry(signal: AbortSignal, userId: string): Promise<Record<string, unknown>> {
    let result: Record<string, unknown> = {};
    await this.apiCallWithSelfHeal(signal, async (innerSignal, token) => {
      result = await this.getProfile(innerSignal, token, userId);
    });
    return result;
  }

  private async getWorkoutActivitiesWithRetry(
    signal: AbortSignal,
    userId: string,
    limit: number,
    totalWorkouts: number,
  ): Promise<Array<Record<string, unknown>>> {
    let result: Array<Record<string, unknown>> = [];
    await this.apiCallWithSelfHeal(signal, async (innerSignal, token) => {
      result = await this.getWorkoutActivities(innerSignal, token, userId, limit, totalWorkouts);
    });
    return result;
  }

  private async getStrengthScoresCurrentWithRetry(
    signal: AbortSignal,
    userId: string,
  ): Promise<Array<Record<string, unknown>>> {
    let result: Array<Record<string, unknown>> = [];
    await this.apiCallWithSelfHeal(signal, async (innerSignal, token) => {
      result = await this.getStrengthScoresCurrent(innerSignal, token, userId);
    });
    return result;
  }

  private async getStrengthScoresHistoryWithRetry(
    signal: AbortSignal,
    userId: string,
  ): Promise<Array<Record<string, unknown>>> {
    let result: Array<Record<string, unknown>> = [];
    await this.apiCallWithSelfHeal(signal, async (innerSignal, token) => {
      result = await this.getStrengthScoresHistory(innerSignal, token, userId);
    });
    return result;
  }
}

function extractJwtExpiry(idToken: string): Date | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("invalid JWT format");
  }
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const json = Buffer.from(payload + "=".repeat((4 - (payload.length % 4 || 4)) % 4), "base64").toString("utf-8");
  const parsed = JSON.parse(json) as { exp?: number };
  if (!parsed.exp) {
    throw new Error("exp claim not found or invalid");
  }
  return new Date(parsed.exp * 1000);
}

function isRetriableTonalError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  if (error instanceof TonalApiError) {
    return error.statusCode >= 500;
  }

  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("connection reset") ||
    message.includes("timeout") ||
    message.includes("temporarily unavailable") ||
    isAbortError(error)
  );
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("request aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function toBadGatewayMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}
