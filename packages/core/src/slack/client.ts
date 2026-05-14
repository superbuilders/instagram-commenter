import { createHmac, timingSafeEqual } from "crypto";

const SLACK_API = "https://slack.com/api";

interface SlackResponse {
  ok: boolean;
  error?: string;
  ts?: string;
}

async function slackFetch(
  method: string,
  body: Record<string, unknown>,
  token: string
): Promise<SlackResponse> {
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as SlackResponse;
  if (!data.ok) {
    throw new Error(`Slack API ${method} failed: ${data.error}`);
  }
  return data;
}

export async function postMessage(
  channel: string,
  blocks: unknown[],
  text: string,
  token: string
): Promise<string> {
  const result = await slackFetch(
    "chat.postMessage",
    { channel, blocks, text },
    token
  );
  return result.ts!;
}

export async function updateMessage(
  channel: string,
  ts: string,
  blocks: unknown[],
  text: string,
  token: string
): Promise<void> {
  await slackFetch(
    "chat.update",
    { channel, ts, blocks, text },
    token
  );
}

export async function openModal(
  triggerId: string,
  view: Record<string, unknown>,
  token: string
): Promise<void> {
  await slackFetch("views.open", { trigger_id: triggerId, view }, token);
}

export function verifySignature(
  body: string,
  timestamp: string,
  signature: string,
  signingSecret: string
): boolean {
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
  if (parseInt(timestamp) < fiveMinutesAgo) return false;

  const baseString = `v0:${timestamp}:${body}`;
  const hmac = createHmac("sha256", signingSecret)
    .update(baseString)
    .digest("hex");
  const computed = `v0=${hmac}`;

  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
  } catch {
    return false;
  }
}
