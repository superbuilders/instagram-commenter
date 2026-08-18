import { vpc } from "./vpc";
import { db, dbPassword } from "./database";
import {
  anthropicKey,
  openaiKey,
  slackBotToken,
  slackSigningSecret,
  slackChannelId,
  slackKnowledgeGapChannelId,
  slackRelationshipChannelId,
} from "./secrets";

const dbEnv = {
  DATABASE_HOST: db.address,
  DATABASE_PORT: db.port.apply((p) => String(p)),
  DATABASE_NAME: "instagram_commenter",
  DATABASE_USERNAME: "app",
};

const isProductionStage = $app.stage === "production";
const cronsEnabled = process.env.ENABLE_COMMENT_CRONS
  ? process.env.ENABLE_COMMENT_CRONS === "true"
  : isProductionStage;
const postRepliesEnabled = process.env.ENABLE_POST_REPLY_CRON === "true";
const deleteCommentsEnabled = process.env.ENABLE_DELETE_COMMENT_CRON === "true";
const autoIngestEnabled = process.env.ENABLE_AUTO_INGEST_CRON === "true";
const weeklyEvalEnabled = process.env.ENABLE_WEEKLY_EVAL_CRON === "true";
const relationshipEnabled = process.env.ENABLE_RELATIONSHIP_CRON === "true";

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
  enabled: postRepliesEnabled,
  schedule: "rate(2 minutes)",
  function: cronFn("packages/functions/src/post-replies.handler", "60 seconds"),
});

export const deleteComments = new sst.aws.Cron("DeleteComments", {
  enabled: deleteCommentsEnabled,
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
  // EventBridge rules evaluate cron expressions in UTC. Run hourly and let the
  // handler post only at the configured America/Chicago local hour.
  schedule: "cron(0 * * * ? *)",
  function: cronFn("packages/functions/src/slack-digest.handler", "60 seconds", [slackBotToken, slackChannelId, slackKnowledgeGapChannelId]),
});

export const researchCommenters = new sst.aws.Cron("ResearchCommenters", {
  enabled: relationshipEnabled,
  schedule: "rate(1 hour)",
  function: cronFn(
    "packages/functions/src/research-commenters.handler",
    "120 seconds",
    [slackBotToken, slackRelationshipChannelId]
  ),
});

export const refreshToken = new sst.aws.Cron("RefreshToken", {
  enabled: cronsEnabled,
  schedule: "rate(1 day)",
  function: cronFn("packages/functions/src/refresh-token.handler", "30 seconds", [slackBotToken, slackChannelId]),
});

export const weeklyEval = new sst.aws.Cron("WeeklyEval", {
  enabled: weeklyEvalEnabled,
  // EventBridge rules evaluate cron expressions in UTC. Run hourly and let the
  // handler post only at the configured America/Chicago local time.
  schedule: "cron(0 * * * ? *)",
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
  enabled: autoIngestEnabled,
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
