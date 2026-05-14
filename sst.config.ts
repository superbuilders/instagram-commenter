/// <reference path="./.sst/platform/config.d.ts" />

function getEnvironment(stage?: string): string {
  if (stage === "production") return "production";
  if (stage === "staging") return "staging";
  if (stage === "dev") return "dev";
  return "ephemeral";
}

export default $config({
  app(input) {
    const stage = input?.stage;

    return {
      name: "instagram-commenter",
      removal: stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(stage),
      home: "aws",
      providers: {
        aws: {
          region: "us-east-1",
          defaultTags: {
            tags: {
              Project: "instagram-commenter",
              Environment: getEnvironment(stage),
              ManagedBy: "sst",
              Owner: "yash.chitneni@superbuilders.school",
            },
          },
        },
      },
    };
  },
  async run() {
    await import("./infra/vpc");
    const { db } = await import("./infra/database");
    await import("./infra/secrets");
    const storage = await import("./infra/storage");
    await import("./infra/api");
    await import("./infra/crons");
    const { slackHandler } = await import("./infra/slack");
    const { dbPassword } = await import("./infra/database");
    const { vpc } = await import("./infra/vpc");

    const { openaiKey, slackBotToken, slackChannelId } = await import("./infra/secrets");

    const migrator = new sst.aws.Function("Migrator", {
      url: true,
      handler: "packages/functions/src/run-migrate.handler",
      timeout: "60 seconds",
      vpc,
      link: [dbPassword],
      environment: {
        DATABASE_HOST: db.address,
        DATABASE_PORT: db.port.apply((p) => String(p)),
        DATABASE_NAME: "instagram_commenter",
        DATABASE_USERNAME: "app",
      },
      copyFiles: [
        { from: "packages/core/src/db/migrations", to: "core/src/db/migrations" },
      ],
    });

    const seeder = new sst.aws.Function("Seeder", {
      url: true,
      handler: "packages/functions/src/run-seed.handler",
      timeout: "900 seconds",
      memory: "1024 MB",
      vpc,
      link: [dbPassword, openaiKey],
      environment: {
        DATABASE_HOST: db.address,
        DATABASE_PORT: db.port.apply((p) => String(p)),
        DATABASE_NAME: "instagram_commenter",
        DATABASE_USERNAME: "app",
      },
      copyFiles: [
        { from: "data/podcasts", to: "data/podcasts" },
        { from: "data/voice-samples", to: "data/voice-samples" },
      ],
    });

    const addAccount = new sst.aws.Function("AddAccount", {
      url: true,
      handler: "packages/functions/src/add-account.handler",
      timeout: "30 seconds",
      vpc,
      link: [dbPassword, slackBotToken, slackChannelId],
      environment: {
        DATABASE_HOST: db.address,
        DATABASE_PORT: db.port.apply((p) => String(p)),
        DATABASE_NAME: "instagram_commenter",
        DATABASE_USERNAME: "app",
      },
    });

    return {
      MyBucket: storage.bucket.name,
      DatabaseEndpoint: db.endpoint,
      SlackHandlerUrl: slackHandler.url,
      MigratorUrl: migrator.url,
      SeederUrl: seeder.url,
      AddAccountUrl: addAccount.url,
    };
  },
});
