import { eq, and, isNull } from "drizzle-orm";
import { comments, posts, accounts } from "@instagram-commenter/core/db";
import { recordPipelineEvent } from "@instagram-commenter/core/pipeline";
import { deleteComment } from "@instagram-commenter/core/instagram";
import {
  postMessage,
  buildDeleteApprovalMessage,
} from "@instagram-commenter/core/slack";
import { createCronHandler, log } from "./lib/handler.js";
import { getSlackBotToken, getSlackChannelId } from "./lib/secrets.js";

export const handler = createCronHandler("delete-comments", async (db) => {
  const deletionEnabled = process.env.DELETION_ENABLED?.trim().toLowerCase() === "true";
  if (!deletionEnabled) {
    log("info", "Comment deletion is disabled via DELETION_ENABLED");
    return;
  }

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
      deleteReason: comments.deleteReason,
      postId: comments.postId,
      deleteSlackTs: comments.deleteSlackTs,
    })
    .from(comments)
    .where(
      and(
        eq(comments.classificationGroup, "delete"),
        isNull(comments.deletedAt),
        isNull(comments.deleteSlackTs)
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
    await recordPipelineEvent(db, {
      commentId: comment.id,
      stage: "delete_review",
      status: "started",
      payload: { confidence, deleteReason: comment.deleteReason ?? null },
    });

    // Low confidence — reclassify as skip
    if (confidence < 0.7) {
      await db
        .update(comments)
        .set({
          classificationGroup: "skip",
          skipReason: "delete_low_confidence_reclassified",
        })
        .where(eq(comments.id, comment.id));

      await recordPipelineEvent(db, {
        commentId: comment.id,
        stage: "delete_review",
        status: "skipped",
        reasonCode: "delete_low_confidence_reclassified",
        payload: { confidence },
      });

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
          await recordPipelineEvent(db, {
            commentId: comment.id,
            stage: "delete_execute",
            status: "succeeded",
            reasonCode: "auto_deleted",
            payload: { confidence },
          });
          log("info", "Auto-deleted comment", { commentId: comment.id });
        } catch (err) {
          await recordPipelineEvent(db, {
            commentId: comment.id,
            stage: "delete_execute",
            status: "failed",
            reasonCode: "auto_delete_failed",
            reasonDetail: err instanceof Error ? err.message : String(err),
            payload: { confidence },
          });
          log("error", "Auto-delete failed", {
            commentId: comment.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      continue;
    }

    // Medium confidence — send to Slack for approval
    const [post] = await db
      .select({ caption: posts.caption, permalink: posts.permalink })
      .from(posts)
      .where(eq(posts.id, comment.postId));

    const msg = buildDeleteApprovalMessage(
      {
        id: comment.id,
        text: comment.text,
        authorUsername: comment.authorUsername ?? "unknown",
        likesCount: comment.likesCount,
        postCaption: post?.caption ?? "",
        postPermalink: post?.permalink ?? undefined,
      },
      comment.deleteReason ?? "Classified as spam/troll",
      confidence
    );

    const ts = await postMessage(channelId, msg.blocks, msg.text, slackToken);

    await db
      .update(comments)
      .set({ deleteSlackTs: ts })
      .where(eq(comments.id, comment.id));

    await recordPipelineEvent(db, {
      commentId: comment.id,
      stage: "delete_review",
      status: "succeeded",
      reasonCode: "sent_for_delete_review",
      payload: { confidence, slackMessageTs: ts },
    });

    log("info", "Delete sent to Slack for approval", {
      commentId: comment.id,
      confidence,
    });
  }
});
