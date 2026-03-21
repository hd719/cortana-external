import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

loadDotenv({ path: path.join(repoRoot, ".env") });

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3033),
  MARKET_DATA_CACHE_DIR: z.string().default(".cache/market_data"),
  MARKET_DATA_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  MARKET_DATA_UNIVERSE_SEED_PATH: z.string().default("backtester/data/universe.py"),
  SCHWAB_CLIENT_ID: z.string().default(""),
  SCHWAB_CLIENT_SECRET: z.string().default(""),
  SCHWAB_REFRESH_TOKEN: z.string().default(""),
  SCHWAB_TOKEN_PATH: z.string().default(".cache/market_data/schwab-token.json"),
  SCHWAB_API_BASE_URL: z.string().default("https://api.schwabapi.com"),
  SCHWAB_TOKEN_URL: z.string().default("https://api.schwabapi.com/v1/oauth/token"),
  FRED_API_KEY: z.string().default(""),
  WHOOP_CLIENT_ID: z.string().default(""),
  WHOOP_CLIENT_SECRET: z.string().default(""),
  WHOOP_REDIRECT_URL: z.string().default("http://localhost:3033/auth/callback"),
  WHOOP_TOKEN_PATH: z.string().default("whoop_tokens.json"),
  WHOOP_DATA_PATH: z.string().default("whoop_data.json"),
  TONAL_EMAIL: z.string().default(""),
  TONAL_PASSWORD: z.string().default(""),
  TONAL_TOKEN_PATH: z.string().default("tonal_tokens.json"),
  TONAL_DATA_PATH: z.string().default("tonal_data.json"),
  ALPACA_KEYS_PATH: z.string().default(""),
  ALPACA_TARGET_ENVIRONMENT: z.string().default("live"),
  CORTANA_DATABASE_URL: z.string().default("postgres://localhost:5432/cortana?sslmode=disable"),
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
