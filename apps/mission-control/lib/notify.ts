type RiskLevel = "p0" | "p1" | "p2" | "p3";

type ApprovalTelegramNotificationInput = {
  approvalId: string;
  riskLevel: RiskLevel;
  actionType: string;
  agentId: string;
  rationale?: string | null;
};

const TELEGRAM_CHAT_ID = "8171372724";

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const getMissionControlBaseUrl = (): string =>
  process.env.MISSION_CONTROL_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";

const getApprovalMessageText = (input: ApprovalTelegramNotificationInput): string => {
  const risk = input.riskLevel.toUpperCase();
  const rationale = input.rationale?.trim() ? input.rationale.trim() : "No rationale provided.";
  const approvalsUrl = `${getMissionControlBaseUrl().replace(/\/$/, "")}/approvals`;

  return [
    `🔐 <b>Approval Required</b> [${escapeHtml(risk)}]`,
    "",
    `<b>Action:</b> ${escapeHtml(input.actionType)}`,
    `<b>Agent:</b> ${escapeHtml(input.agentId)}`,
    `<b>Rationale:</b> ${escapeHtml(rationale)}`,
    "",
    `<a href=\"${escapeHtml(approvalsUrl)}\">View in Mission Control</a>`,
  ].join("\n");
};

export async function sendApprovalTelegramNotification(input: ApprovalTelegramNotificationInput): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    console.warn("[notify] TELEGRAM_BOT_TOKEN is not configured; skipping Telegram notification");
    return;
  }

  const endpoint = `https://api.telegram.org/bot${token}/sendMessage`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: getApprovalMessageText(input),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Approve", callback_data: `approve:${input.approvalId}` },
            { text: "❌ Reject", callback_data: `reject:${input.approvalId}` },
          ],
        ],
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`[notify] Telegram API failed (${response.status}): ${body}`);
  }
}
