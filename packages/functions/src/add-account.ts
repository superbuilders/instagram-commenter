import { eq } from "drizzle-orm";
import { Resource } from "sst";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@instagram-commenter/core/db";

export async function handler(event: { body?: string } = {}) {
  const host = process.env.DATABASE_HOST;
  const port = process.env.DATABASE_PORT ?? "5432";
  const dbName = process.env.DATABASE_NAME ?? "instagram_commenter";
  const user = process.env.DATABASE_USERNAME ?? "app";
  const password = (Resource as any).DatabasePassword.value;
  const url = `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/${dbName}`;
  const pool = new pg.Pool({ connectionString: url, max: 1, ssl: { rejectUnauthorized: false } });
  const db = drizzle(pool, { schema });

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    // Support deactivating an account by platformId (nulls the token)
    if (body.action === "deactivate" && body.platformId) {
      const updated = await db
        .update(schema.accounts)
        .set({ accessToken: null, updatedAt: new Date() })
        .where(eq(schema.accounts.platformId, body.platformId))
        .returning();
      await pool.end();
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, deactivated: updated.length }),
      };
    }

    const [account] = await db
      .insert(schema.accounts)
      .values({
        platform: "instagram",
        platformId: body.platformId ?? "17841461806812229",
        username: body.username ?? "futureof_education",
        displayName: body.displayName ?? "MacKenzie Price | Founder of 2HourLearning",
        accessToken: body.accessToken,
        tokenExpiresAt: body.tokenExpiresAt ? new Date(body.tokenExpiresAt) : null,
      })
      .onConflictDoUpdate({
        target: schema.accounts.platformId,
        set: {
          accessToken: body.accessToken,
          tokenExpiresAt: body.tokenExpiresAt ? new Date(body.tokenExpiresAt) : null,
          updatedAt: new Date(),
        },
      })
      .returning();

    await pool.end();
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, account: account ?? "already exists" }),
    };
  } catch (err: any) {
    await pool.end();
    return { statusCode: 500, body: err.message };
  }
}
