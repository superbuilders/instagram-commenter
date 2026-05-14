import { Resource } from "sst";
import { createDb, type Database } from "@instagram-commenter/core/db";

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;

  const host = process.env.DATABASE_HOST;
  const port = process.env.DATABASE_PORT ?? "5432";
  const name = process.env.DATABASE_NAME;
  const user = process.env.DATABASE_USERNAME;

  if (!host || !name || !user) {
    throw new Error("DATABASE_HOST, DATABASE_NAME, DATABASE_USERNAME required");
  }

  const password = (Resource as any).DatabasePassword.value;
  const url = `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/${name}`;

  dbInstance = createDb(url);
  return dbInstance;
}
