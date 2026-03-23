import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { createDb, type Database } from "@instagram-commenter/core/db";

let dbInstance: Database | null = null;
let cachedPassword: string | null = null;

async function getDbPassword(): Promise<string> {
  if (cachedPassword) return cachedPassword;

  const secretArn = process.env.DATABASE_SECRET_ARN;
  if (!secretArn) throw new Error("DATABASE_SECRET_ARN not set");

  const client = new SecretsManagerClient({});
  const result = await client.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  if (!result.SecretString) throw new Error("Empty secret");

  const secret = JSON.parse(result.SecretString) as { password: string };
  cachedPassword = secret.password;
  return cachedPassword;
}

export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;

  const host = process.env.DATABASE_HOST;
  const port = process.env.DATABASE_PORT ?? "5432";
  const name = process.env.DATABASE_NAME;
  const user = process.env.DATABASE_USERNAME;

  if (!host || !name || !user) {
    throw new Error("DATABASE_HOST, DATABASE_NAME, DATABASE_USERNAME required");
  }

  const password = await getDbPassword();
  const url = `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/${name}`;

  dbInstance = createDb(url);
  return dbInstance;
}
