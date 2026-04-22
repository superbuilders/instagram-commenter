import { vpc } from "./vpc";
import { db, dbPassword } from "./database";
import {
  anthropicKey,
  openaiKey,
  slackBotToken,
  slackSigningSecret,
  slackChannelId,
} from "./secrets";

const dbEnv = {
  DATABASE_HOST: db.address,
  DATABASE_PORT: db.port.apply((p) => String(p)),
  DATABASE_NAME: "instagram_commenter",
  DATABASE_USERNAME: "app",
};

const cronsEnabled = process.env.ENABLE_COMMENT_CRONS === "true";

function cronFn(
  handler: string,
  timeout: string,
  extraLinks: any[] = [],
  extraEnv: Record<string, string> = {}
) {
  return {
    handler,
    timeout,
    vpc,
    link: [dbPassword, ...extraLinks],
    environment: { ...dbEnv, ...extraEnv },
  };
}

export const ingestComments = new sst.aws.Cron("IngestComments", {
  enabled: cronsEnabled,
  schedule: "rate(5 minutes)",
  function: cronFn("packages/functions/src/ingest-comments.handler", "60 seconds"),
});

export const classifyComments = new sst.aws.Cron("ClassifyComments", {
  enabled: cronsEnabled,
  schedule: "rate(10 minutes)",
  function: cronFn("packages/functions/src/classify-comments.handler", "120 seconds", [anthropicKey]),
});

export const allocateReplies = new sst.aws.Cron("AllocateReplies", {
  enabled: cronsEnabled,
  schedule: "rate(15 minutes)",
  function: cronFn("packages/functions/src/allocate-replies.handler", "300 seconds", [anthropicKey, openaiKey, slackBotToken, slackChannelId]),
});

export const postReplies = new sst.aws.Cron("PostReplies", {
  enabled: cronsEnabled,
  schedule: "rate(2 minutes)",
  function: cronFn("packages/functions/src/post-replies.handler", "60 seconds"),
});

export const deleteComments = new sst.aws.Cron("DeleteComments", {
  enabled: cronsEnabled,
  schedule: "rate(15 minutes)",
  function: cronFn(
    "packages/functions/src/delete-comments.handler",
    "60 seconds",
    [slackBotToken, slackChannelId],
    {
      DELETION_ENABLED: process.env.DELETION_ENABLED ?? "false",
    }
  ),
});

export const slackDigest = new sst.aws.Cron("SlackDigest", {
  enabled: cronsEnabled,
  schedule: "cron(0 14 * * ? *)",
  function: cronFn("packages/functions/src/slack-digest.handler", "60 seconds", [slackBotToken, slackChannelId]),
});

export const refreshToken = new sst.aws.Cron("RefreshToken", {
  enabled: cronsEnabled,
  schedule: "rate(1 day)",
  function: cronFn("packages/functions/src/refresh-token.handler", "30 seconds", [slackBotToken, slackChannelId]),
});

export const weeklyEval = new sst.aws.Cron("WeeklyEval", {
  enabled: cronsEnabled,
  schedule: "cron(0 15 ? * MON *)",
  function: {
    handler: "packages/functions/src/run-eval-cron.handler",
    timeout: "900 seconds",
    vpc,
    link: [dbPassword, anthropicKey, slackBotToken, slackChannelId],
    environment: dbEnv,
    copyFiles: [
      { from: "data/eval-dataset-reviewed.json", to: "data/eval-dataset-reviewed.json" },
    ],
  },
});

export const autoIngest = new sst.aws.Cron("AutoIngest", {
  enabled: cronsEnabled,
  schedule: "rate(1 hour)",
  function: cronFn(
    "packages/functions/src/auto-ingest.handler",
    "300 seconds",
    [openaiKey],
    {
      WORKFLOWY_API_TOKEN: process.env.WORKFLOWY_API_TOKEN ?? "",
      WORKFLOWY_BRAINLIFT_ROOT_ID: process.env.WORKFLOWY_BRAINLIFT_ROOT_ID ?? "",
      SUBSTACK_RSS_URL: process.env.SUBSTACK_RSS_URL ?? "https://futureofeducation.substack.com/feed",
    }
  ),
});
