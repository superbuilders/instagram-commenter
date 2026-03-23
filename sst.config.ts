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

    return {
      MyBucket: storage.bucket.name,
      DatabaseEndpoint: db.endpoint,
      DatabaseSecretArn: db.masterUserSecret.apply(
        (s) => s?.secretArn ?? ""
      ),
      SlackHandlerUrl: slackHandler.url,
    };
  },
});
