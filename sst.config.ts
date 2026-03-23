/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "instagram-commenter",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
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

    return {
      MyBucket: storage.bucket.name,
      DatabaseEndpoint: db.endpoint,
      SlackHandlerUrl: slackHandler.url,
      MigratorUrl: migrator.url,
    };
  },
});
