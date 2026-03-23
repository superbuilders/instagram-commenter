import type { Context } from "aws-lambda";
import type { Database } from "@instagram-commenter/core/db";
import { getDb } from "./db.js";

export function log(
  level: "info" | "warn" | "error",
  message: string,
  data?: Record<string, unknown>
) {
  const entry = { level, message, timestamp: new Date().toISOString(), ...data };
  console.log(JSON.stringify(entry));
}

type CronHandler = (db: Database) => Promise<void>;

export function createCronHandler(name: string, fn: CronHandler) {
  return async (_event: unknown, _context: Context) => {
    log("info", `${name} started`);
    const start = Date.now();

    try {
      const db = await getDb();
      await fn(db);
      log("info", `${name} completed`, { durationMs: Date.now() - start });
    } catch (err) {
      log("error", `${name} failed`, {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      throw err;
    }
  };
}

type HttpHandler = (
  db: Database,
  body: string,
  headers: Record<string, string | undefined>
) => Promise<{ statusCode: number; body: string }>;

export function createHttpHandler(name: string, fn: HttpHandler) {
  return async (event: { body?: string; headers?: Record<string, string> }) => {
    log("info", `${name} received request`);

    try {
      const db = await getDb();
      const body = event.body ?? "";
      const headers = event.headers ?? {};
      return await fn(db, body, headers);
    } catch (err) {
      log("error", `${name} failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return { statusCode: 500, body: "Internal server error" };
    }
  };
}
