import { and, desc, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { Resource } from "sst";
import { comments, createDb, posts, replies } from "@instagram-commenter/core/db";

const SLACK_API_BASE = "https://slack.com/api";
const DEFAULT_OLDER_THAN_HOURS = 24;
const DEFAULT_LIMIT = 100;

interface Args {
  apply: boolean;
  deleteSlackMessages: boolean;
  channelId: string | null;
  olderThanHours: number;
  limit: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: false,
    deleteSlackMessages: false,
    channelId: getSecret("SlackChannelId", "SLACK_CHANNEL_ID", false),
    olderThanHours: DEFAULT_OLDER_THAN_HOURS,
    limit: DEFAULT_LIMIT,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--delete-slack-messages") {
      args.deleteSlackMessages = true;
    } else if (arg === "--channel-id") {
      args.channelId = argv[++i] ?? null;
    } else if (arg === "--older-than-hours") {
      args.olderThanHours = Number(argv[++i]);
    } else if (arg === "--limit") {
      args.limit = Number(argv[++i]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.olderThanHours) || args.olderThanHours <= 0) {
    throw new Error("--older-than-hours must be a positive number");
  }

  if (!Number.isInteger(args.limit) || args.limit <= 0) {
    throw new Error("--limit must be a positive integer");
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

function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const host = process.env.DATABASE_HOST;
  const port = process.env.DATABASE_PORT ?? "5432";
  const name = process.env.DATABASE_NAME;
  const user = process.env.DATABASE_USERNAME;
  const password = getSecret("DatabasePassword", "DATABASE_PASSWORD");

  if (!host || !name || !user || !password) {
    throw new Error(
      "DATABASE_URL or DATABASE_HOST, DATABASE_NAME, DATABASE_USERNAME, and DatabasePassword are required"
    );
  }

  return `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
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

async function deleteSlackMessage(
  token: string,
  channelId: string,
  messageTs: string
): Promise<void> {
  const result = await slackApi<{ ok: boolean; error?: string }>(
    token,
    "chat.delete",
    {
      channel: channelId,
      ts: messageTs,
    }
  );

  if (!result.ok) {
    throw new Error(`Slack chat.delete failed for ${messageTs}: ${result.error ?? "unknown error"}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.deleteSlackMessages && !args.channelId) {
    throw new Error("SLACK_CHANNEL_ID or --channel-id is required with --delete-slack-messages");
  }

  const connectionString = getDatabaseUrl();
  const db = createDb(connectionString);
  const olderThan = new Date(
    Date.now() - args.olderThanHours * 60 * 60 * 1000
  );

  const stale = await db
    .select({
      replyId: replies.id,
      commentId: comments.id,
      commentText: comments.text,
      approvalStatus: replies.approvalStatus,
      slackMessageTs: replies.slackMessageTs,
      replyCreatedAt: replies.createdAt,
      postPermalink: posts.permalink,
    })
    .from(replies)
    .innerJoin(comments, eq(replies.commentId, comments.id))
    .innerJoin(posts, eq(comments.postId, posts.id))
    .where(
      and(
        eq(replies.approvalStatus, "pending"),
        isNotNull(replies.slackMessageTs),
        lt(replies.createdAt, olderThan)
      )
    )
    .orderBy(desc(replies.createdAt))
    .limit(args.limit);

  console.log(
    `${args.apply ? "Applying" : "Dry run"}: found ${stale.length} stale pending Slack review replies older than ${args.olderThanHours}h.`
  );

  for (const row of stale) {
    console.log(
      [
        row.replyId,
        row.replyCreatedAt.toISOString(),
        `ts=${row.slackMessageTs}`,
        `"${row.commentText.slice(0, 90).replace(/\s+/g, " ")}"`,
      ].join(" | ")
    );
  }

  if (!args.apply || stale.length === 0) {
    console.log("No database rows were changed.");
    if (args.deleteSlackMessages) {
      console.log("No Slack messages were deleted.");
    }
    process.exit(0);
  }

  await db
    .update(replies)
    .set({
      approvalStatus: "rejected",
      reviewOutcomeReason: "other",
      reviewOutcomeCategory: "operator",
      reviewOutcomeNotes:
        "stale_review_reset: retired by clear-slack-review-slate without deleting or editing Slack messages.",
    })
    .where(
      inArray(
        replies.id,
        stale.map((row) => row.replyId)
      )
    );

  let deletedSlackMessages = 0;
  if (args.deleteSlackMessages) {
    const token = getSecret("SlackBotToken", "SLACK_BOT_TOKEN");
    for (const row of stale) {
      if (!row.slackMessageTs) continue;
      await deleteSlackMessage(token!, args.channelId!, row.slackMessageTs);
      deletedSlackMessages++;
    }
  }

  console.log(`Marked ${stale.length} pending replies as rejected with stale_review_reset notes.`);
  console.log(`Deleted ${deletedSlackMessages} Slack messages.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to clear Slack review slate:", err);
  process.exit(1);
});
