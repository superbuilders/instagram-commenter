import { vpc } from "./vpc";
import { db } from "./database";
import {
  openaiKey,
  slackBotToken,
  slackSigningSecret,
  slackChannelId,
} from "./secrets";

export const slackHandler = new sst.aws.Function("SlackHandler", {
  url: true,
  handler: "packages/functions/src/slack-approval.handler",
  timeout: "30 seconds",
  vpc,
  link: [openaiKey, slackBotToken, slackSigningSecret, slackChannelId],
  environment: {
    DATABASE_HOST: db.address,
    DATABASE_PORT: db.port.apply((p) => String(p)),
    DATABASE_NAME: db.dbName.apply((n) => n ?? "instagram_commenter"),
    DATABASE_USERNAME: db.username.apply((u) => u ?? "app"),
    DATABASE_SECRET_ARN: db.masterUserSecret.apply((s) => s?.secretArn ?? ""),
  },
});
