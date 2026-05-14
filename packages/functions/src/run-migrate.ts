import { Resource } from "sst";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as path from "path";

export async function handler() {
  const host = process.env.DATABASE_HOST;
  const port = process.env.DATABASE_PORT ?? "5432";
  const dbName = process.env.DATABASE_NAME ?? "instagram_commenter";
  const user = process.env.DATABASE_USERNAME ?? "app";
  const password = (Resource as any).DatabasePassword.value;

  const connectionString = `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/${dbName}`;
  const pool = new pg.Pool({ connectionString, max: 1, ssl: { rejectUnauthorized: false } });

  try {
    console.log("Enabling pgvector extension...");
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector;");
    console.log("pgvector extension enabled.");

    console.log("Running Drizzle migrations...");
    // Try multiple possible paths since bundler may relocate files
    const candidates = [
      path.resolve(__dirname, "../core/src/db/migrations"),
      path.resolve(__dirname, "core/src/db/migrations"),
      path.resolve(__dirname, "migrations"),
      "/var/task/core/src/db/migrations",
      "/var/task/packages/core/src/db/migrations",
    ];
    let migrationsFolder = "";
    for (const c of candidates) {
      try {
        const fs = await import("fs");
        if (fs.existsSync(path.join(c, "meta/_journal.json"))) {
          migrationsFolder = c;
          break;
        }
      } catch {}
    }
    if (!migrationsFolder) {
      // List what's in the Lambda to debug
      const fs = await import("fs");
      const listDir = (dir: string, depth = 0): string[] => {
        const results: string[] = [];
        try {
          for (const f of fs.readdirSync(dir)) {
            results.push("  ".repeat(depth) + f);
            if (depth < 3) {
              try { results.push(...listDir(path.join(dir, f), depth + 1)); } catch {}
            }
          }
        } catch {}
        return results;
      };
      const listing = listDir("/var/task", 0).join("\n");
      return { statusCode: 500, body: `No migrations folder found.\n\nLambda contents:\n${listing}` };
    }
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
    console.log("Migrations complete.");

    return { statusCode: 200, body: "Migrations complete" };
  } catch (err: any) {
    console.error("Migration failed:", err);
    return { statusCode: 500, body: err.message };
  } finally {
    await pool.end();
  }
}
