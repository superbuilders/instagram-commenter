import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 1 });
  return drizzle(pool, { schema });
}

export type Database = ReturnType<typeof createDb>;
