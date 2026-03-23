import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as fs from "fs";
import * as path from "path";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL env var is required. Run via: npm run migrate");
  process.exit(1);
}

const migrationsDir = path.resolve(
  import.meta.dirname,
  "../packages/core/src/db/migrations"
);

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });

try {
  const pgvectorSql = fs.readFileSync(
    path.join(migrationsDir, "0000_enable_pgvector.sql"),
    "utf-8"
  );
  console.log("Enabling pgvector extension...");
  await pool.query(pgvectorSql);
  console.log("pgvector extension enabled.");

  console.log("Running Drizzle migrations...");
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: migrationsDir });
  console.log("Migrations complete.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
