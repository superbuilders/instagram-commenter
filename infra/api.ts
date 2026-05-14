import { bucket } from "./storage";
import { vpc } from "./vpc";
import { db, dbPassword } from "./database";

export const myApi = new sst.aws.Function("MyApi", {
  url: true,
  link: [bucket, dbPassword],
  vpc,
  handler: "packages/functions/src/api.handler",
  environment: {
    DATABASE_HOST: db.address,
    DATABASE_PORT: db.port.apply((p) => String(p)),
    DATABASE_NAME: "instagram_commenter",
    DATABASE_USERNAME: "app",
  },
});
