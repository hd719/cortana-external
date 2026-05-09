import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { WhoopLiveEventArtifact, WhoopTelegramNotifier, WhoopTelegramResult } from "./webhook-types.js";

type OpenClawTelegramConfig = {
  channels?: {
    telegram?: {
      allowFrom?: unknown[];
      accounts?: Record<string, { botToken?: unknown }>;
    };
  };
};

type TelegramRouting = {
  botToken: string | null;
  chatId: string | null;
};

const OPENCLAW_CONFIG_PATH = path.join(os.homedir(), ".openclaw", "openclaw.json");

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMetric(label: string, value: number | null, suffix = ""): string | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${label} ${formatted}${suffix}`;
}

function activityTitle(activityType: string): string {
  if (activityType === "workout") return "Workout updated";
  if (activityType === "sleep") return "Sleep updated";
  if (activityType === "recovery") return "Recovery updated";
  return "WHOOP updated";
}

function buildTelegramText(artifact: WhoopLiveEventArtifact): string {
  const signals = [
    formatMetric("strain", artifact.signals.strain),
    formatMetric("duration", artifact.signals.workout_duration_seconds != null ? Math.round(artifact.signals.workout_duration_seconds / 60) : null, "m"),
    formatMetric("avg HR", artifact.signals.avg_heart_rate, " bpm"),
    formatMetric("recovery", artifact.signals.recovery_score, "%"),
    formatMetric("sleep", artifact.signals.sleep_performance, "%"),
    formatMetric("HRV", artifact.signals.hrv),
  ].filter((item): item is string => Boolean(item));

  const signalLine = signals.length > 0 ? signals.join(" | ") : "Snapshot refreshed; no headline metric changed.";
  const title = activityTitle(artifact.activity_type);

  return [
    `⚔️ <b>Spartan - WHOOP Live</b>`,
    `<b>${escapeHtml(title)}</b>`,
    escapeHtml(signalLine),
    escapeHtml(artifact.policy.reason),
  ].join("\n");
}

function readRouting(accountId: string): TelegramRouting {
  const envToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
  const envChatId = process.env.TELEGRAM_CHAT_ID?.trim() || null;
  if (envToken && envChatId) {
    return { botToken: envToken, chatId: envChatId };
  }

  const cfg = readJson<OpenClawTelegramConfig>(OPENCLAW_CONFIG_PATH);
  const botToken =
    envToken ??
    cfg?.channels?.telegram?.accounts?.[accountId]?.botToken ??
    cfg?.channels?.telegram?.accounts?.default?.botToken ??
    null;
  const chatId =
    envChatId ??
    (Array.isArray(cfg?.channels?.telegram?.allowFrom) && cfg.channels.telegram.allowFrom[0] !== undefined
      ? String(cfg.channels.telegram.allowFrom[0])
      : null);

  return {
    botToken: botToken ? String(botToken) : null,
    chatId,
  };
}

export class TelegramWhoopNotifier implements WhoopTelegramNotifier {
  constructor(
    private readonly options: {
      enabled: boolean;
      accountId: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async sendLiveEventMessage(artifact: WhoopLiveEventArtifact): Promise<WhoopTelegramResult> {
    if (!this.options.enabled) {
      return { status: "no_reply" };
    }

    const routing = readRouting(this.options.accountId || "spartan");
    if (!routing.botToken || !routing.chatId) {
      return { status: "failed", error: "telegram routing is not configured" };
    }

    const fetchImpl = this.options.fetchImpl ?? fetch;
    const response = await fetchImpl(`https://api.telegram.org/bot${routing.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: routing.chatId,
        text: buildTelegramText(artifact),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    const responseBody = await response.text().catch(() => "");
    if (!response.ok) {
      return { status: "failed", error: `Telegram API failed (${response.status}): ${responseBody.slice(0, 500)}` };
    }

    try {
      const parsed = JSON.parse(responseBody) as { result?: { message_id?: unknown } };
      return {
        status: "sent",
        telegramMessageId: parsed.result?.message_id != null ? String(parsed.result.message_id) : undefined,
      };
    } catch {
      return { status: "sent" };
    }
  }
}
