import { desc, eq } from "drizzle-orm";
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

    if (body.action === "feedback_inspect") {
      if (body.exportKey !== password) {
        await pool.end();
        return { statusCode: 403, body: JSON.stringify({ success: false, error: "Forbidden" }) };
      }

      const limit = Number.isFinite(Number(body.limit))
        ? Math.min(Math.max(Number(body.limit), 1), 25)
        : 10;

      const reviewedReplies = await db
        .select({
          replyId: schema.replies.id,
          approvalStatus: schema.replies.approvalStatus,
          reviewOutcomeReason: schema.replies.reviewOutcomeReason,
          reviewOutcomeCategory: schema.replies.reviewOutcomeCategory,
          reviewOutcomeNotes: schema.replies.reviewOutcomeNotes,
          originalText: schema.replies.originalText,
          editedText: schema.replies.editedText,
          approvedBy: schema.replies.approvedBy,
          approvedAt: schema.replies.approvedAt,
          replyCreatedAt: schema.replies.createdAt,
          commentId: schema.comments.id,
          commentText: schema.comments.text,
          authorUsername: schema.comments.authorUsername,
          classificationGroup: schema.comments.classificationGroup,
          classificationConfidence: schema.comments.classificationConfidence,
          narrativeTopic: schema.comments.narrativeTopic,
          infoType: schema.comments.infoType,
          skipReason: schema.comments.skipReason,
          deleteReason: schema.comments.deleteReason,
          classificationRationaleTags: schema.comments.classificationRationaleTags,
          commentedAt: schema.comments.commentedAt,
          postPermalink: schema.posts.permalink,
        })
        .from(schema.replies)
        .innerJoin(schema.comments, eq(schema.replies.commentId, schema.comments.id))
        .innerJoin(schema.posts, eq(schema.comments.postId, schema.posts.id))
        .where(eq(schema.replies.approvalStatus, body.status ?? "rejected"))
        .orderBy(desc(schema.replies.createdAt))
        .limit(limit);

      const feedback = await Promise.all(
        reviewedReplies.map(async (reply) => {
          const examples = await db
            .select({
              id: schema.responseExamples.id,
              source: schema.responseExamples.source,
              isPositive: schema.responseExamples.isPositive,
              reviewReason: schema.responseExamples.reviewReason,
              reviewNotes: schema.responseExamples.reviewNotes,
              policyVersion: schema.responseExamples.policyVersion,
              createdAt: schema.responseExamples.createdAt,
            })
            .from(schema.responseExamples)
            .where(eq(schema.responseExamples.originalReplyId, reply.replyId))
            .orderBy(desc(schema.responseExamples.createdAt))
            .limit(5);

          const events = await db
            .select({
              id: schema.commentPipelineEvents.id,
              stage: schema.commentPipelineEvents.stage,
              status: schema.commentPipelineEvents.status,
              reasonCode: schema.commentPipelineEvents.reasonCode,
              reasonDetail: schema.commentPipelineEvents.reasonDetail,
              payload: schema.commentPipelineEvents.payload,
              createdAt: schema.commentPipelineEvents.createdAt,
            })
            .from(schema.commentPipelineEvents)
            .where(eq(schema.commentPipelineEvents.replyId, reply.replyId))
            .orderBy(desc(schema.commentPipelineEvents.createdAt))
            .limit(10);

          return { ...reply, examples, events };
        })
      );

      await pool.end();
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, count: feedback.length, feedback }),
      };
    }

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
