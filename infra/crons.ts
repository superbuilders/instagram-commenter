import { vpc } from "./vpc";
import { db } from "./database";
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
  DATABASE_NAME: db.dbName.apply((n) => n ?? "instagram_commenter"),
  DATABASE_USERNAME: db.username.apply((u) => u ?? "app"),
  DATABASE_SECRET_ARN: db.masterUserSecret.apply((s) => s?.secretArn ?? ""),
};

const commonProps = {
  vpc,
  environment: dbEnv,
};

export const ingestComments = new sst.aws.Cron("IngestComments", {
  schedule: "rate(5 minutes)",
  function: {
    handler: "packages/functions/src/ingest-comments.handler",
    timeout: "60 seconds",
    ...commonProps,
  },
});

export const classifyComments = new sst.aws.Cron("ClassifyComments", {
  schedule: "rate(10 minutes)",
  function: {
    handler: "packages/functions/src/classify-comments.handler",
    timeout: "120 seconds",
    link: [anthropicKey],
    ...commonProps,
  },
});

export const allocateReplies = new sst.aws.Cron("AllocateReplies", {
  schedule: "rate(15 minutes)",
  function: {
    handler: "packages/functions/src/allocate-replies.handler",
    timeout: "300 seconds",
    link: [anthropicKey, openaiKey, slackBotToken, slackChannelId],
    ...commonProps,
  },
});

export const postReplies = new sst.aws.Cron("PostReplies", {
  schedule: "rate(2 minutes)",
  function: {
    handler: "packages/functions/src/post-replies.handler",
    timeout: "60 seconds",
    ...commonProps,
  },
});

export const deleteComments = new sst.aws.Cron("DeleteComments", {
  schedule: "rate(15 minutes)",
  function: {
    handler: "packages/functions/src/delete-comments.handler",
    timeout: "60 seconds",
    link: [slackBotToken, slackChannelId],
    ...commonProps,
  },
});

export const slackDigest = new sst.aws.Cron("SlackDigest", {
  schedule: "cron(0 14 * * ? *)",
  function: {
    handler: "packages/functions/src/slack-digest.handler",
    timeout: "60 seconds",
    link: [slackBotToken, slackChannelId],
    ...commonProps,
  },
});

export const refreshToken = new sst.aws.Cron("RefreshToken", {
  schedule: "rate(1 day)",
  function: {
    handler: "packages/functions/src/refresh-token.handler",
    timeout: "30 seconds",
    link: [slackBotToken, slackChannelId],
    ...commonProps,
  },
});

export const autoIngest = new sst.aws.Cron("AutoIngest", {
  schedule: "rate(1 hour)",
  function: {
    handler: "packages/functions/src/auto-ingest.handler",
    timeout: "300 seconds",
    link: [openaiKey],
    ...commonProps,
    environment: {
      ...dbEnv,
      WORKFLOWY_API_TOKEN: process.env.WORKFLOWY_API_TOKEN ?? "",
      WORKFLOWY_BRAINLIFT_ROOT_ID:
        process.env.WORKFLOWY_BRAINLIFT_ROOT_ID ?? "",
      SUBSTACK_RSS_URL:
        process.env.SUBSTACK_RSS_URL ??
        "https://futureofeducation.substack.com/feed",
    },
  },
});
