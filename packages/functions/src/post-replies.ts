import { eq, and, isNull, inArray } from "drizzle-orm";
import { replies, comments, posts, accounts } from "@instagram-commenter/core/db";
import { postReply } from "@instagram-commenter/core/instagram";
import { incrementPosted } from "@instagram-commenter/core/scheduling";
import { createCronHandler, log } from "./lib/handler.js";

const MAX_PER_RUN = 3;

export const handler = createCronHandler("post-replies", async (db) => {
  const pending = await db
    .select({
      replyId: replies.id,
      originalText: replies.originalText,
      editedText: replies.editedText,
      commentId: replies.commentId,
      approvalStatus: replies.approvalStatus,
    })
    .from(replies)
    .where(
      and(
        inArray(replies.approvalStatus, ["approved", "auto"]),
        isNull(replies.postedAt)
      )
    )
    .limit(MAX_PER_RUN);

  if (pending.length === 0) {
    log("info", "No replies to post");
    return;
  }

  log("info", "Posting replies", { count: pending.length });

  for (const reply of pending) {
    const postedText = reply.editedText ?? reply.originalText;

    // Get the comment's platform ID and account access token
    const [comment] = await db
      .select({
        platformCommentId: comments.platformCommentId,
        postId: comments.postId,
      })
      .from(comments)
      .where(eq(comments.id, reply.commentId));

    if (!comment) {
      log("error", "Comment not found for reply", { replyId: reply.replyId });
      continue;
    }

    const [post] = await db
      .select({ accountId: posts.accountId })
      .from(posts)
      .where(eq(posts.id, comment.postId));

    const [account] = await db
      .select({ accessToken: accounts.accessToken })
      .from(accounts)
      .where(eq(accounts.id, post.accountId));

    if (!account?.accessToken) {
      log("error", "No access token for account", { replyId: reply.replyId });
      continue;
    }

    try {
      const platformReplyId = await postReply(
        comment.platformCommentId,
        postedText,
        { accessToken: account.accessToken }
      );

      await db
        .update(replies)
        .set({
          postedAt: new Date(),
          platformReplyId,
          postedText,
        })
        .where(eq(replies.id, reply.replyId));

      await incrementPosted(post.accountId, db);

      log("info", "Reply posted", {
        replyId: reply.replyId,
        platformReplyId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (message.includes("rate limit") || message.includes("429")) {
        log("warn", "Rate limited — stopping run", { replyId: reply.replyId });
        break;
      }

      log("error", "Failed to post reply", {
        replyId: reply.replyId,
        error: message,
      });
    }
  }
});
