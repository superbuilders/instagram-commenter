import { eq } from "drizzle-orm";
import {
  accounts,
  posts,
  comments,
} from "@instagram-commenter/core/db";
import { recordPipelineEvent } from "@instagram-commenter/core/pipeline";
import {
  getRecentMediaWithStats,
  getCommentsWithStats,
} from "@instagram-commenter/core/instagram";
import { incrementCommentsSeen } from "@instagram-commenter/core/scheduling";
import { createCronHandler, log } from "./lib/handler.js";

const MEDIA_PAGE_LIMIT = getPageLimit("INGEST_MEDIA_PAGE_LIMIT", 1);
const COMMENT_PAGE_LIMIT = getPageLimit("INGEST_COMMENT_PAGE_LIMIT", 10);
const REPLY_PAGE_LIMIT = getPageLimit("INGEST_REPLY_PAGE_LIMIT", 5);

function getPageLimit(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (!raw) return fallback;
  if (raw.toLowerCase() === "all") return Number.POSITIVE_INFINITY;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export const handler = createCronHandler("ingest-comments", async (db) => {
  const activeAccounts = await db.select().from(accounts);

  for (const account of activeAccounts) {
    if (!account.accessToken) {
      log("warn", "Account missing access token", { accountId: account.id });
      continue;
    }

    const opts = {
      accessToken: account.accessToken,
      accountId: account.platformId,
    };

    const mediaResult = await getRecentMediaWithStats(opts, MEDIA_PAGE_LIMIT);
    const media = mediaResult.posts;
    log("info", "Fetched recent media", {
      accountId: account.id,
      postCount: media.length,
      pagesFetched: mediaResult.stats.pagesFetched,
      hitPageLimit: mediaResult.stats.hitPageLimit,
      pageLimit: MEDIA_PAGE_LIMIT,
    });

    for (const post of media) {
      // Upsert post
      const existingPost = await db
        .select()
        .from(posts)
        .where(eq(posts.platformPostId, post.id));

      let postId: string;
      if (existingPost.length > 0) {
        postId = existingPost[0].id;
      } else {
        const [inserted] = await db
          .insert(posts)
          .values({
            accountId: account.id,
            platform: account.platform,
            platformPostId: post.id,
            caption: post.caption ?? null,
            mediaType: post.media_type,
            permalink: post.permalink,
            postedAt: new Date(post.timestamp),
          })
          .returning({ id: posts.id });
        postId = inserted.id;
      }

      // Fetch comments
      const commentResult = await getCommentsWithStats(
        post.id,
        opts,
        COMMENT_PAGE_LIMIT,
        REPLY_PAGE_LIMIT
      );
      const igComments = commentResult.comments;
      if (
        post.comments_count != null &&
        igComments.length < post.comments_count
      ) {
        log("warn", "Fetched fewer comments than Instagram reports", {
          postId: post.id,
          expectedComments: post.comments_count,
          fetchedTopLevelComments: igComments.length,
          topLevelPagesFetched: commentResult.topLevelStats.pagesFetched,
          hitPageLimit: commentResult.topLevelStats.hitPageLimit,
          commentPageLimit: COMMENT_PAGE_LIMIT,
        });
      }

      let newCount = 0;
      for (const comment of igComments) {
        const commentedAt = new Date(comment.timestamp);
        if (commentedAt < account.createdAt) continue;

        const authorUsername = comment.username || comment.from?.username || null;

        // Skip account owner's comments or comments with no text
        if (authorUsername === account.username) continue;
        if (!comment.text) continue;

        // Dedupe
        const existing = await db
          .select({ id: comments.id })
          .from(comments)
          .where(eq(comments.platformCommentId, comment.id));

        if (existing.length > 0) continue;

        const [insertedComment] = await db.insert(comments).values({
          postId,
          platformCommentId: comment.id,
          authorUsername,
          authorId: comment.from?.id ?? null,
          text: comment.text,
          likesCount: comment.like_count,
          isFromAccountOwner: false,
          commentedAt,
        }).returning({ id: comments.id });
        newCount++;

        await recordPipelineEvent(db, {
          commentId: insertedComment.id,
          stage: "ingest",
          status: "succeeded",
          reasonCode: "ingested_comment",
          payload: { isTopLevel: true, postId },
        });

        // Also ingest replies to this comment
        if (comment.replies?.data) {
          // Look up internal UUID for parent comment
          const parentUuid = insertedComment.id;

          for (const reply of comment.replies.data) {
            const repliedAt = new Date(reply.timestamp);
            if (repliedAt < account.createdAt) continue;

            const replyAuthorUsername = reply.username || reply.from?.username || null;

            if (replyAuthorUsername === account.username) continue;
            if (!reply.text) continue;

            const existingReply = await db
              .select({ id: comments.id })
              .from(comments)
              .where(eq(comments.platformCommentId, reply.id));

            if (existingReply.length > 0) continue;

            const [insertedReply] = await db.insert(comments).values({
              postId,
              platformCommentId: reply.id,
              parentCommentId: parentUuid,
              authorUsername: replyAuthorUsername,
              authorId: reply.from?.id ?? null,
              text: reply.text,
              likesCount: reply.like_count,
              isFromAccountOwner: false,
              commentedAt: repliedAt,
            }).returning({ id: comments.id });
            newCount++;

            await recordPipelineEvent(db, {
              commentId: insertedReply.id,
              stage: "ingest",
              status: "succeeded",
              reasonCode: "ingested_reply",
              payload: { isTopLevel: false, parentCommentId: parentUuid, postId },
            });
          }
        }
      }

      if (newCount > 0) {
        await incrementCommentsSeen(account.id, newCount, db);

        log("info", "Ingested new comments", {
          postId: post.id,
          newComments: newCount,
          topLevelPagesFetched: commentResult.topLevelStats.pagesFetched,
          replyPagesFetched: commentResult.replyStats.replyPagesFetched,
          hitCommentPageLimit: commentResult.topLevelStats.hitPageLimit,
          hitReplyPageLimit: commentResult.replyStats.hitReplyPageLimit,
        });
      }
    }
  }
});
