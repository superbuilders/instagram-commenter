import { Resource } from "sst";

const SLACK_API_BASE = "https://slack.com/api";
const DEFAULT_LIMIT = 200;

interface Args {
  apply: boolean;
  channelId: string | null;
  beforeTs: string | null;
  afterTs: string | null;
  limit: number;
}

interface SlackMessage {
  ts: string;
  text?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
}

interface SlackHistoryResponse {
  ok: boolean;
  error?: string;
  messages?: SlackMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
}

interface SlackDeleteResponse {
  ok: boolean;
  error?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: false,
    channelId: getSecret("SlackChannelId", "SLACK_CHANNEL_ID", false),
    beforeTs: null,
    afterTs: null,
    limit: DEFAULT_LIMIT,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--channel-id") {
      args.channelId = argv[++i] ?? null;
    } else if (arg === "--before-ts") {
      args.beforeTs = argv[++i] ?? null;
    } else if (arg === "--after-ts") {
      args.afterTs = argv[++i] ?? null;
    } else if (arg === "--limit") {
      args.limit = Number(argv[++i]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.channelId) {
    throw new Error("SLACK_CHANNEL_ID or --channel-id is required");
  }

  if (!Number.isInteger(args.limit) || args.limit <= 0 || args.limit > 1000) {
    throw new Error("--limit must be an integer from 1 to 1000");
  }

  return args;
}

function getSecret(
  resourceName: string,
  envFallback: string,
  required = true
): string | null {
  try {
    const val = (Resource as any)[resourceName]?.value;
    if (val) return val;
  } catch {}

  const env = process.env[envFallback];
  if (env) return env;
  if (required) throw new Error(`${resourceName} secret not available`);
  return null;
}

async function slackApi<T>(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`${SLACK_API_BASE}/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Slack HTTP ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

async function fetchBotMessages(
  token: string,
  args: Args
): Promise<SlackMessage[]> {
  const messages: SlackMessage[] = [];
  let cursor: string | undefined;

  while (messages.length < args.limit) {
    const result = await slackApi<SlackHistoryResponse>(
      token,
      "conversations.history",
      {
        channel: args.channelId,
        cursor,
        limit: Math.min(200, args.limit - messages.length),
        latest: args.beforeTs ?? undefined,
        oldest: args.afterTs ?? undefined,
      }
    );

    if (!result.ok) {
      throw new Error(`Slack history failed: ${result.error ?? "unknown error"}`);
    }

    for (const message of result.messages ?? []) {
      if (message.bot_id || message.subtype === "bot_message") {
        messages.push(message);
      }
    }

    cursor = result.response_metadata?.next_cursor || undefined;
    if (!result.has_more || !cursor) break;
  }

  return messages.slice(0, args.limit);
}

async function deleteMessage(
  token: string,
  channelId: string,
  message: SlackMessage
): Promise<void> {
  const result = await slackApi<SlackDeleteResponse>(token, "chat.delete", {
    channel: channelId,
    ts: message.ts,
  });

  if (!result.ok) {
    throw new Error(`Failed to delete ${message.ts}: ${result.error ?? "unknown error"}`);
  }
}

async function main() {
  const token = getSecret("SlackBotToken", "SLACK_BOT_TOKEN");
  const args = parseArgs(process.argv.slice(2));
  const messages = await fetchBotMessages(token!, args);

  console.log(
    `${args.apply ? "Applying" : "Dry run"}: found ${messages.length} bot messages in ${args.channelId}.`
  );

  for (const message of messages) {
    console.log(
      [
        message.ts,
        message.bot_id ? `bot=${message.bot_id}` : "bot_message",
        `"${(message.text ?? "").slice(0, 90).replace(/\s+/g, " ")}"`,
      ].join(" | ")
    );
  }

  if (!args.apply || messages.length === 0) {
    console.log("No Slack messages were deleted.");
    process.exit(0);
  }

  for (const message of messages) {
    await deleteMessage(token!, args.channelId!, message);
  }

  console.log(`Deleted ${messages.length} bot messages from ${args.channelId}.`);
}

main().catch((err) => {
  console.error("Failed to prune Slack bot messages:", err);
  process.exit(1);
});
