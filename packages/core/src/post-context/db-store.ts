import { eq } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { postContextJobs, postContexts } from "../db/schema.js";
import type { PostContext, PostContextJob, PostContextStore } from "./jobs.js";

function toJob(row: typeof postContextJobs.$inferSelect): PostContextJob {
  return {
    id: row.id,
    postId: row.postId,
    status: row.status as PostContextJob["status"],
    apifyRunId: row.apifyRunId,
    apifyDatasetId: row.apifyDatasetId,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toContext(row: typeof postContexts.$inferSelect): PostContext {
  return {
    id: row.id,
    postId: row.postId,
    transcript: row.transcript,
    durationSeconds: row.durationSeconds,
    thumbnailUrl: row.thumbnailUrl,
    sourceUrl: row.sourceUrl,
    metadata: row.metadata as Record<string, unknown> | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDbPostContextStore(db: Database): PostContextStore {
  return {
    async getJobForPost(postId) {
      const [row] = await db
        .select()
        .from(postContextJobs)
        .where(eq(postContextJobs.postId, postId))
        .limit(1);
      return row ? toJob(row) : undefined;
    },
    async createPendingJob(input) {
      const [row] = await db
        .insert(postContextJobs)
        .values({
          postId: input.postId,
          status: "pending",
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: postContextJobs.postId,
          set: {
            status: "pending",
            failureReason: null,
            updatedAt: input.now,
          },
        })
        .returning();
      return toJob(row);
    },
    async markJobReady(input) {
      const [row] = await db
        .update(postContextJobs)
        .set({
          status: "ready",
          apifyRunId: input.apifyRunId,
          apifyDatasetId: input.apifyDatasetId,
          failureReason: null,
          updatedAt: input.now,
        })
        .where(eq(postContextJobs.postId, input.postId))
        .returning();
      return toJob(row);
    },
    async markJobFailed(input) {
      const [row] = await db
        .update(postContextJobs)
        .set({
          status: "failed",
          apifyRunId: input.apifyRunId ?? null,
          apifyDatasetId: input.apifyDatasetId ?? null,
          failureReason: input.failureReason,
          updatedAt: input.now,
        })
        .where(eq(postContextJobs.postId, input.postId))
        .returning();
      return toJob(row);
    },
    async upsertContext(input) {
      const [row] = await db
        .insert(postContexts)
        .values({
          postId: input.postId,
          transcript: input.transcript,
          durationSeconds: input.durationSeconds,
          thumbnailUrl: input.thumbnailUrl,
          sourceUrl: input.sourceUrl,
          metadata: input.metadata,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: postContexts.postId,
          set: {
            transcript: input.transcript,
            durationSeconds: input.durationSeconds,
            thumbnailUrl: input.thumbnailUrl,
            sourceUrl: input.sourceUrl,
            metadata: input.metadata,
            updatedAt: input.now,
          },
        })
        .returning();
      return toContext(row);
    },
    async getContextForPost(postId) {
      const [row] = await db
        .select()
        .from(postContexts)
        .where(eq(postContexts.postId, postId))
        .limit(1);
      return row ? toContext(row) : undefined;
    },
  };
}
