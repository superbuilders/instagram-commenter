import { bucket } from "./storage";
import { vpc } from "./vpc";
import { db } from "./database";

export const myApi = new sst.aws.Function("MyApi", {
  url: true,
  link: [bucket],
  vpc,
  handler: "packages/functions/src/api.handler",
  environment: {
    DATABASE_HOST: db.address,
    DATABASE_PORT: db.port.apply((p) => String(p)),
    DATABASE_NAME: db.dbName.apply((n) => n ?? "instagram_commenter"),
    DATABASE_USERNAME: db.username.apply((u) => u ?? "app"),
    DATABASE_SECRET_ARN: db.masterUserSecret.apply(
      (s) => s?.secretArn ?? ""
    ),
  },
});
