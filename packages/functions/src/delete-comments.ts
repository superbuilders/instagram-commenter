import { eq, and, isNull } from "drizzle-orm";
import { comments, posts, accounts } from "@instagram-commenter/core/db";
import { deleteComment } from "@instagram-commenter/core/instagram";
import {
  postMessage,
  buildDeleteApprovalMessage,
} from "@instagram-commenter/core/slack";
import { createCronHandler, log } from "./lib/handler.js";
import { getSlackBotToken, getSlackChannelId } from "./lib/secrets.js";

export const handler = createCronHandler("delete-comments", async (db) => {
  const slackToken = getSlackBotToken();
  const channelId = getSlackChannelId();

  const candidates = await db
    .select({
      id: comments.id,
      text: comments.text,
      platformCommentId: comments.platformCommentId,
      authorUsername: comments.authorUsername,
      likesCount: comments.likesCount,
      classificationConfidence: comments.classificationConfidence,
      postId: comments.postId,
    })
    .from(comments)
    .where(
      and(
        eq(comments.classificationGroup, "delete"),
        isNull(comments.deletedAt)
      )
    )
    .limit(20);

  if (candidates.length === 0) {
    log("info", "No delete candidates");
    return;
  }

  log("info", "Processing delete candidates", { count: candidates.length });

  for (const comment of candidates) {
    const confidence = comment.classificationConfidence ?? 0;

    // Low confidence — reclassify as skip
    if (confidence < 0.7) {
      await db
        .update(comments)
        .set({ classificationGroup: "skip" })
        .where(eq(comments.id, comment.id));
      log("info", "Low confidence delete reclassified as skip", {
        commentId: comment.id,
        confidence,
      });
      continue;
    }

    // High confidence — auto-delete
    if (confidence >= 0.95) {
      const [post] = await db
        .select({ accountId: posts.accountId })
        .from(posts)
        .where(eq(posts.id, comment.postId));

      const [account] = await db
        .select({ accessToken: accounts.accessToken })
        .from(accounts)
        .where(eq(accounts.id, post.accountId));

      if (account?.accessToken) {
        try {
          await deleteComment(comment.platformCommentId, {
            accessToken: account.accessToken,
          });
          await db
            .update(comments)
            .set({ deletedAt: new Date(), deletedBy: "auto" })
            .where(eq(comments.id, comment.id));
          log("info", "Auto-deleted comment", { commentId: comment.id });
        } catch (err) {
          log("error", "Auto-delete failed", {
            commentId: comment.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      continue;
    }

    // Medium confidence — send to Slack for approval
    const msg = buildDeleteApprovalMessage(
      {
        id: comment.id,
        text: comment.text,
        authorUsername: comment.authorUsername ?? "unknown",
        likesCount: comment.likesCount,
        postCaption: "",
      },
      "Classified as spam/troll",
      confidence
    );

    await postMessage(channelId, msg.blocks, msg.text, slackToken);
    log("info", "Delete sent to Slack for approval", {
      commentId: comment.id,
      confidence,
    });
  }
});
