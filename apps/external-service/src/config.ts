import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

loadDotenv({ path: path.join(repoRoot, ".env") });

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3033),
  MARKET_DATA_CACHE_DIR: z.string().default(".cache/market_data"),
  MARKET_DATA_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  MARKET_DATA_UNIVERSE_SOURCE_LADDER: z.string().default("local_json"),
  MARKET_DATA_UNIVERSE_REMOTE_JSON_URL: z.string().default(""),
  MARKET_DATA_UNIVERSE_LOCAL_JSON_PATH: z.string().default("config/universe/sp500-constituents.json"),
  MARKET_DATA_SCHWAB_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(3),
  MARKET_DATA_SCHWAB_COOLDOWN_MS: z.coerce.number().int().positive().default(20_000),
  COINMARKETCAP_API_KEY: z.string().default(""),
  COINMARKETCAP_API_BASE_URL: z.string().default("https://pro-api.coinmarketcap.com"),
  SCHWAB_CLIENT_ID: z.string().default(""),
  SCHWAB_CLIENT_SECRET: z.string().default(""),
  SCHWAB_REFRESH_TOKEN: z.string().default(""),
  SCHWAB_CLIENT_STREAMER_ID: z.string().default(""),
  SCHWAB_CLIENT_STREAMER_SECRET: z.string().default(""),
  SCHWAB_STREAMER_REFRESH_TOKEN: z.string().default(""),
  SCHWAB_AUTH_URL: z.string().default("https://api.schwabapi.com/v1/oauth/authorize"),
  SCHWAB_REDIRECT_URL: z.string().default("https://127.0.0.1:8182/auth/schwab/callback"),
  SCHWAB_TOKEN_PATH: z.string().default(".cache/market_data/schwab-token.json"),
  SCHWAB_STREAMER_TOKEN_PATH: z.string().default(".cache/market_data/schwab-streamer-token.json"),
  SCHWAB_API_BASE_URL: z.string().default("https://api.schwabapi.com"),
  SCHWAB_TOKEN_URL: z.string().default("https://api.schwabapi.com/v1/oauth/token"),
  SCHWAB_USER_PREFERENCES_URL: z.string().default(""),
  SCHWAB_STREAMER_ENABLED: z.string().default("1"),
  SCHWAB_STREAMER_ROLE: z.enum(["auto", "leader", "follower", "disabled"]).default("leader"),
  SCHWAB_STREAMER_PG_LOCK_KEY: z.coerce.number().int().default(814021),
  SCHWAB_STREAMER_SHARED_STATE_BACKEND: z.enum(["file", "postgres"]).default("postgres"),
  SCHWAB_STREAMER_SHARED_STATE_PATH: z.string().default(".cache/market_data/schwab-streamer-state.json"),
  SCHWAB_STREAMER_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  SCHWAB_STREAMER_QUOTE_TTL_MS: z.coerce.number().int().positive().default(15_000),
  SCHWAB_STREAMER_AFTER_HOURS_QUOTE_TTL_MS: z.coerce.number().int().positive().default(259_200_000),
  SCHWAB_STREAMER_SYMBOL_SOFT_CAP: z.coerce.number().int().positive().default(250),
  SCHWAB_STREAMER_CACHE_SOFT_CAP: z.coerce.number().int().positive().default(500),
  SCHWAB_STREAMER_EQUITY_FIELDS: z.string().default("0,1,2,3,8,19,20,32,34,42"),
  SCHWAB_STREAMER_ACCOUNT_ACTIVITY_ENABLED: z.string().default("1"),
  SCHWAB_STREAMER_RECONNECT_JITTER_MS: z.coerce.number().int().nonnegative().default(500),
  FRED_API_KEY: z.string().default(""),
  WHOOP_CLIENT_ID: z.string().default(""),
  WHOOP_CLIENT_SECRET: z.string().default(""),
  WHOOP_REDIRECT_URL: z.string().default("http://localhost:3033/auth/callback"),
  WHOOP_TOKEN_PATH: z.string().default("whoop_tokens.json"),
  WHOOP_DATA_PATH: z.string().default("whoop_data.json"),
  WHOOP_WEBHOOK_ENABLED: z.string().default("false"),
  WHOOP_WEBHOOK_SECRET: z.string().default(""),
  WHOOP_WEBHOOK_PUBLIC_URL: z.string().default(""),
  WHOOP_WEBHOOK_REPLAY_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),
  WHOOP_WEBHOOK_RAW_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  WHOOP_WEBHOOK_COALESCE_WINDOW_MS: z.coerce.number().int().nonnegative().default(45_000),
  WHOOP_WEBHOOK_PROCESSOR_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  WHOOP_WEBHOOK_PROCESS_BATCH_SIZE: z.coerce.number().int().positive().default(5),
  WHOOP_WEBHOOK_BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(65_536),
  WHOOP_LIVE_EVENT_TELEGRAM_ENABLED: z.string().default("true"),
  WHOOP_LIVE_EVENT_TELEGRAM_ACCOUNT_ID: z.string().default("spartan"),
  TONAL_EMAIL: z.string().default(""),
  TONAL_PASSWORD: z.string().default(""),
  TONAL_TOKEN_PATH: z.string().default("tonal_tokens.json"),
  TONAL_DATA_PATH: z.string().default("tonal_data.json"),
  APPLE_HEALTH_DATA_PATH: z.string().default(path.join(os.homedir(), ".openclaw/data/apple-health/latest.json")),
  APPLE_HEALTH_MAX_AGE_HOURS: z.coerce.number().positive().default(36),
  APPLE_HEALTH_API_TOKEN: z.string().default(""),
  POLYMARKET_API_KEY: z.string().default(""),
  POLYMARKET_KEY_ID: z.string().default(""),
  POLYMARKET_CLIENT_KEY: z.string().default(""),
  POLYMARKET_SECRET_KEY: z.string().default(""),
  POLYMARKET_SECRET: z.string().default(""),
  POLYMARKET_PUBLIC_BASE_URL: z.string().default("https://gateway.polymarket.us"),
  POLYMARKET_API_BASE_URL: z.string().default("https://api.polymarket.us"),
  POLYMARKET_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  POLYMARKET_PINNED_MARKETS_PATH: z.string().default(".cache/polymarket/pinned-markets.json"),
  ALPACA_KEYS_PATH: z.string().default(""),
  ALPACA_TARGET_ENVIRONMENT: z.string().default("live"),
  CORTANA_DATABASE_URL: z.string().default("postgres://localhost:5432/cortana?sslmode=disable"),
  EXTERNAL_SERVICE_TLS_PORT: z.coerce.number().int().positive().default(8182),
  EXTERNAL_SERVICE_TLS_CERT_PATH: z.string().default(""),
  EXTERNAL_SERVICE_TLS_KEY_PATH: z.string().default(""),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = ConfigSchema.parse(process.env);
  return cachedConfig;
}
