import { eq, and } from "drizzle-orm";
import {
  accounts,
  posts,
  comments,
} from "@instagram-commenter/core/db";
import {
  getRecentMedia,
  getComments,
} from "@instagram-commenter/core/instagram";
import { createCronHandler, log } from "./lib/handler.js";

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

    const media = await getRecentMedia(opts);
    log("info", "Fetched recent media", {
      accountId: account.id,
      postCount: media.length,
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
      const igComments = await getComments(post.id, opts);

      let newCount = 0;
      for (const comment of igComments) {
        // Skip account owner's comments
        if (comment.username === account.username) continue;

        // Dedupe
        const existing = await db
          .select({ id: comments.id })
          .from(comments)
          .where(eq(comments.platformCommentId, comment.id));

        if (existing.length > 0) continue;

        await db.insert(comments).values({
          postId,
          platformCommentId: comment.id,
          authorUsername: comment.username,
          text: comment.text,
          likesCount: comment.like_count,
          isFromAccountOwner: false,
          commentedAt: new Date(comment.timestamp),
        });
        newCount++;

        // Also ingest replies to this comment
        if (comment.replies?.data) {
          for (const reply of comment.replies.data) {
            if (reply.username === account.username) continue;

            const existingReply = await db
              .select({ id: comments.id })
              .from(comments)
              .where(eq(comments.platformCommentId, reply.id));

            if (existingReply.length > 0) continue;

            await db.insert(comments).values({
              postId,
              platformCommentId: reply.id,
              parentCommentId: comment.id,
              authorUsername: reply.username,
              text: reply.text,
              likesCount: reply.like_count,
              isFromAccountOwner: false,
              commentedAt: new Date(reply.timestamp),
            });
            newCount++;
          }
        }
      }

      if (newCount > 0) {
        log("info", "Ingested new comments", {
          postId: post.id,
          newComments: newCount,
        });
      }
    }
  }
});
