/**
 * Workspace field, section, and file definitions.
 *
 * Pure configuration data — no logic, no I/O.
 * Each field maps an env key to its UI representation in the services configuration tab.
 */

import path from "node:path";
import type { WorkspaceFileId, WorkspaceFieldInput, WorkspaceFieldOption } from "./service-workspace";

export type WorkspaceFieldDefinition = {
  key: string;
  label: string;
  help: string;
  fileId: WorkspaceFileId;
  sectionId: string;
  input?: WorkspaceFieldInput;
  defaultValue?: string;
  placeholder?: string;
  options?: WorkspaceFieldOption[];
};

export const WORKSPACE_FILES: Record<WorkspaceFileId, { label: string; relativePath: string }> = {
  external: { label: "External Service", relativePath: ".env" },
  missionControl: { label: "Mission Control", relativePath: path.join("apps", "mission-control", ".env.local") },
};

export const WORKSPACE_SECTIONS: Array<{ id: string; label: string; description: string; fileId: WorkspaceFileId }> = [
  {
    id: "openclaw-bridge",
    label: "OpenClaw Bridge",
    description: "Mission Control runtime, data sources, and the OpenClaw lifecycle bridge.",
    fileId: "missionControl",
  },
  {
    id: "service-runtime",
    label: "Service Runtime",
    description: "Network, TLS, cache, and external-service runtime settings.",
    fileId: "external",
  },
  {
    id: "market-data",
    label: "Market Data",
    description: "Universe sources, Schwab streamer policy, and broker-facing controls.",
    fileId: "external",
  },
  {
    id: "recovery-stack",
    label: "Recovery Stack",
    description: "Whoop, Tonal, and market-data provider credentials and storage.",
    fileId: "external",
  },
  {
    id: "whoop-streaming",
    label: "WHOOP Streaming",
    description: "Live WHOOP webhook ingestion, processing, retention, and Spartan Telegram delivery.",
    fileId: "external",
  },
];

export const WORKSPACE_FIELDS: WorkspaceFieldDefinition[] = [
  // ── OpenClaw Bridge ──
  { key: "DATABASE_URL", label: "Mission Control database URL", help: "Primary Prisma/Postgres connection for Mission Control.", fileId: "missionControl", sectionId: "openclaw-bridge", input: "textarea", placeholder: "postgres://localhost:5432/mission_control?sslmode=disable" },
  { key: "CORTANA_DATABASE_URL", label: "Cortana source database URL", help: "Optional read source for operational tables.", fileId: "missionControl", sectionId: "openclaw-bridge", input: "textarea", placeholder: "postgres://localhost:5432/cortana?sslmode=disable" },
  { key: "DOCS_PATH", label: "Docs path", help: "Override the docs library source loaded in Mission Control.", fileId: "missionControl", sectionId: "openclaw-bridge", input: "text", placeholder: "/Users/hd/Developer/cortana/docs" },
  { key: "AGENT_MODELS_PATH", label: "Agent models path", help: "Maps agent ids to preferred OpenClaw model labels.", fileId: "missionControl", sectionId: "openclaw-bridge", input: "text", placeholder: "/Users/hd/Developer/cortana/config/agent-models.json" },
  { key: "HEARTBEAT_STATE_PATH", label: "Heartbeat state path", help: "Location of the OpenClaw heartbeat state file Mission Control watches.", fileId: "missionControl", sectionId: "openclaw-bridge", input: "text", placeholder: "/Users/hd/.openclaw/memory/heartbeat-state.json" },
  { key: "OPENCLAW_EVENT_TOKEN", label: "OpenClaw event token", help: "Bearer token for sub-agent lifecycle ingestion into Mission Control.", fileId: "missionControl", sectionId: "openclaw-bridge", input: "secret", placeholder: "Optional bearer token" },
  { key: "TELEGRAM_BOT_TOKEN", label: "Telegram bot token", help: "Needed for notification flows inside Mission Control.", fileId: "missionControl", sectionId: "openclaw-bridge", input: "secret", placeholder: "Bot token" },

  // ── Service Runtime ──
  { key: "PORT", label: "External service port", help: "HTTP port for the local Hono external-service runtime.", fileId: "external", sectionId: "service-runtime", input: "text", defaultValue: "3033", placeholder: "3033" },
  { key: "EXTERNAL_SERVICE_TLS_PORT", label: "TLS port", help: "HTTPS callback and TLS listener port for OAuth flows.", fileId: "external", sectionId: "service-runtime", input: "text", defaultValue: "8182", placeholder: "8182" },
  { key: "EXTERNAL_SERVICE_TLS_CERT_PATH", label: "TLS certificate path", help: "Certificate file used for local TLS/OAuth callbacks.", fileId: "external", sectionId: "service-runtime", input: "text", placeholder: "/absolute/path/to/cert.pem" },
  { key: "EXTERNAL_SERVICE_TLS_KEY_PATH", label: "TLS key path", help: "Private key paired with the external-service TLS certificate.", fileId: "external", sectionId: "service-runtime", input: "text", placeholder: "/absolute/path/to/key.pem" },
  { key: "MARKET_DATA_CACHE_DIR", label: "Market-data cache directory", help: "Disk cache for universe snapshots and provider artifacts.", fileId: "external", sectionId: "service-runtime", input: "text", defaultValue: ".cache/market_data", placeholder: ".cache/market_data" },
  { key: "MARKET_DATA_REQUEST_TIMEOUT_MS", label: "Request timeout (ms)", help: "Default timeout applied to market-data upstream requests.", fileId: "external", sectionId: "service-runtime", input: "text", defaultValue: "30000", placeholder: "30000" },

  // ── Market Data ──
  { key: "MARKET_DATA_UNIVERSE_SOURCE_LADDER", label: "Universe source ladder", help: "Ordered provider strategy used to assemble the trading universe.", fileId: "external", sectionId: "market-data", input: "text", defaultValue: "local_json", placeholder: "local_json" },
  { key: "MARKET_DATA_UNIVERSE_REMOTE_JSON_URL", label: "Remote universe JSON URL", help: "Optional remote universe source before falling back to local JSON.", fileId: "external", sectionId: "market-data", input: "text", placeholder: "https://example.com/universe.json" },
  { key: "MARKET_DATA_UNIVERSE_LOCAL_JSON_PATH", label: "Local universe JSON path", help: "Fallback local universe file used when remote sources fail.", fileId: "external", sectionId: "market-data", input: "text", defaultValue: "config/universe/sp500-constituents.json", placeholder: "config/universe/sp500-constituents.json" },
  { key: "SCHWAB_REDIRECT_URL", label: "Schwab redirect URL", help: "OAuth callback URL registered with the Schwab developer app.", fileId: "external", sectionId: "market-data", input: "text", defaultValue: "https://127.0.0.1:8182/auth/schwab/callback", placeholder: "https://127.0.0.1:8182/auth/schwab/callback" },
  { key: "SCHWAB_TOKEN_PATH", label: "Schwab token path", help: "Cached token file used for REST and streamer sessions.", fileId: "external", sectionId: "market-data", input: "text", defaultValue: ".cache/market_data/schwab-token.json", placeholder: ".cache/market_data/schwab-token.json" },
  { key: "SCHWAB_STREAMER_ROLE", label: "Schwab streamer role", help: "Leader/follower mode for the shared Schwab streamer session.", fileId: "external", sectionId: "market-data", input: "select", defaultValue: "leader", options: [{ label: "Auto", value: "auto" }, { label: "Leader", value: "leader" }, { label: "Follower", value: "follower" }, { label: "Disabled", value: "disabled" }] },
  { key: "SCHWAB_STREAMER_SHARED_STATE_BACKEND", label: "Shared state backend", help: "Where shared streamer coordination state is stored.", fileId: "external", sectionId: "market-data", input: "select", defaultValue: "postgres", options: [{ label: "Postgres", value: "postgres" }, { label: "File", value: "file" }] },
  { key: "SCHWAB_STREAMER_ENABLED", label: "Streamer enabled", help: "Turns the Schwab streamer on or off.", fileId: "external", sectionId: "market-data", input: "select", defaultValue: "1", options: [{ label: "Enabled", value: "1" }, { label: "Disabled", value: "0" }] },
  { key: "SCHWAB_STREAMER_SYMBOL_SOFT_CAP", label: "Streamer symbol soft cap", help: "Soft ceiling for live symbol subscriptions before fallback behavior.", fileId: "external", sectionId: "market-data", input: "text", defaultValue: "250", placeholder: "250" },
  { key: "SCHWAB_STREAMER_CACHE_SOFT_CAP", label: "Streamer cache soft cap", help: "Recent quote cache retention target for streamer-backed symbols.", fileId: "external", sectionId: "market-data", input: "text", defaultValue: "500", placeholder: "500" },
  { key: "SCHWAB_USER_PREFERENCES_URL", label: "Schwab user preferences URL", help: "Optional override for Schwab user preferences endpoint.", fileId: "external", sectionId: "market-data", input: "text", placeholder: "https://api.schwabapi.com/trader/v1/userPreference" },

  // ── Recovery Stack ──
  { key: "SCHWAB_CLIENT_ID", label: "Schwab client id", help: "OAuth client id for Schwab REST and streamer access.", fileId: "external", sectionId: "recovery-stack", input: "text", placeholder: "Client id" },
  { key: "SCHWAB_CLIENT_SECRET", label: "Schwab client secret", help: "OAuth client secret for the Schwab developer app.", fileId: "external", sectionId: "recovery-stack", input: "secret", placeholder: "Client secret" },
  { key: "WHOOP_CLIENT_ID", label: "Whoop client id", help: "OAuth client id for the Whoop recovery integration.", fileId: "external", sectionId: "recovery-stack", input: "text", placeholder: "Client id" },
  { key: "WHOOP_CLIENT_SECRET", label: "Whoop client secret", help: "OAuth client secret used to refresh Whoop tokens.", fileId: "external", sectionId: "recovery-stack", input: "secret", placeholder: "Client secret" },
  { key: "WHOOP_REDIRECT_URL", label: "Whoop redirect URL", help: "Callback URL registered with the Whoop OAuth app.", fileId: "external", sectionId: "recovery-stack", input: "text", defaultValue: "http://localhost:3033/auth/callback", placeholder: "http://localhost:3033/auth/callback" },
  { key: "WHOOP_TOKEN_PATH", label: "Whoop token path", help: "Disk location for cached Whoop access and refresh tokens.", fileId: "external", sectionId: "recovery-stack", input: "text", defaultValue: "whoop_tokens.json", placeholder: "whoop_tokens.json" },
  { key: "WHOOP_DATA_PATH", label: "Whoop data cache path", help: "Cached Whoop recovery and sleep payloads.", fileId: "external", sectionId: "recovery-stack", input: "text", defaultValue: "whoop_data.json", placeholder: "whoop_data.json" },
  { key: "TONAL_EMAIL", label: "Tonal account email", help: "Email address used for Tonal authentication.", fileId: "external", sectionId: "recovery-stack", input: "text", placeholder: "name@example.com" },
  { key: "TONAL_PASSWORD", label: "Tonal account password", help: "Password used for Tonal token acquisition.", fileId: "external", sectionId: "recovery-stack", input: "secret", placeholder: "Password" },
  { key: "TONAL_TOKEN_PATH", label: "Tonal token path", help: "Cached Tonal token location on disk.", fileId: "external", sectionId: "recovery-stack", input: "text", defaultValue: "tonal_tokens.json", placeholder: "tonal_tokens.json" },
  { key: "TONAL_DATA_PATH", label: "Tonal data cache path", help: "Cached Tonal workout and profile data.", fileId: "external", sectionId: "recovery-stack", input: "text", defaultValue: "tonal_data.json", placeholder: "tonal_data.json" },
  { key: "COINMARKETCAP_API_KEY", label: "CoinMarketCap API key", help: "Crypto quote/history provider key used by the market-data chain.", fileId: "external", sectionId: "recovery-stack", input: "secret", placeholder: "API key" },
  { key: "COINMARKETCAP_API_BASE_URL", label: "CoinMarketCap base URL", help: "Optional override for the CoinMarketCap API host.", fileId: "external", sectionId: "recovery-stack", input: "text", defaultValue: "https://pro-api.coinmarketcap.com", placeholder: "https://pro-api.coinmarketcap.com" },
  // ── WHOOP Streaming ──
  { key: "WHOOP_WEBHOOK_ENABLED", label: "WHOOP webhook enabled", help: "Turns public WHOOP webhook ingestion and the live-event processor on or off.", fileId: "external", sectionId: "whoop-streaming", input: "select", defaultValue: "false", options: [{ label: "Disabled", value: "false" }, { label: "Enabled", value: "true" }] },
  { key: "WHOOP_WEBHOOK_PUBLIC_URL", label: "WHOOP webhook public URL", help: "Public HTTPS callback URL configured in the WHOOP Developer Dashboard.", fileId: "external", sectionId: "whoop-streaming", input: "text", placeholder: "https://example.com/webhooks/whoop" },
  { key: "WHOOP_WEBHOOK_SECRET", label: "WHOOP webhook secret", help: "WHOOP app secret used for HMAC verification of webhook requests.", fileId: "external", sectionId: "whoop-streaming", input: "secret", placeholder: "Webhook signing secret" },
  { key: "CORTANA_DATABASE_URL", label: "Webhook database URL", help: "Postgres connection used by external-service for WHOOP event, artifact, and activity rows.", fileId: "external", sectionId: "whoop-streaming", input: "textarea", defaultValue: "postgres://localhost:5432/cortana?sslmode=disable", placeholder: "postgres://localhost:5432/cortana?sslmode=disable" },
  { key: "WHOOP_WEBHOOK_REPLAY_WINDOW_SECONDS", label: "Replay window (seconds)", help: "Maximum accepted age for WHOOP signature timestamps.", fileId: "external", sectionId: "whoop-streaming", input: "text", defaultValue: "300", placeholder: "300" },
  { key: "WHOOP_WEBHOOK_RAW_RETENTION_DAYS", label: "Raw payload retention (days)", help: "How long raw webhook payloads stay attached before compact artifacts become the long-term record.", fileId: "external", sectionId: "whoop-streaming", input: "text", defaultValue: "30", placeholder: "30" },
  { key: "WHOOP_WEBHOOK_COALESCE_WINDOW_MS", label: "Coalesce window (ms)", help: "Delay used to collapse rapid updates for the same WHOOP object before analysis.", fileId: "external", sectionId: "whoop-streaming", input: "text", defaultValue: "45000", placeholder: "45000" },
  { key: "WHOOP_WEBHOOK_PROCESSOR_INTERVAL_MS", label: "Processor interval (ms)", help: "Polling interval for queued WHOOP webhook events.", fileId: "external", sectionId: "whoop-streaming", input: "text", defaultValue: "15000", placeholder: "15000" },
  { key: "WHOOP_WEBHOOK_PROCESS_BATCH_SIZE", label: "Processor batch size", help: "Maximum queued WHOOP events claimed per processor tick.", fileId: "external", sectionId: "whoop-streaming", input: "text", defaultValue: "5", placeholder: "5" },
  { key: "WHOOP_WEBHOOK_BODY_LIMIT_BYTES", label: "Webhook body limit (bytes)", help: "Maximum raw WHOOP webhook request body size accepted by external-service.", fileId: "external", sectionId: "whoop-streaming", input: "text", defaultValue: "65536", placeholder: "65536" },
  { key: "WHOOP_LIVE_EVENT_TELEGRAM_ENABLED", label: "Spartan Telegram enabled", help: "Allows message-worthy WHOOP live events to send Telegram coaching through Spartan.", fileId: "external", sectionId: "whoop-streaming", input: "select", defaultValue: "true", options: [{ label: "Enabled", value: "true" }, { label: "Disabled", value: "false" }] },
  { key: "WHOOP_LIVE_EVENT_TELEGRAM_ACCOUNT_ID", label: "Spartan Telegram account", help: "Telegram account id resolved from OpenClaw config for live WHOOP coaching messages.", fileId: "external", sectionId: "whoop-streaming", input: "text", defaultValue: "spartan", placeholder: "spartan" },
];

export const WORKSPACE_FIELD_LOOKUP = new Map(
  WORKSPACE_FIELDS.map((field) => [`${field.fileId}:${field.key}`, field] as const),
);
