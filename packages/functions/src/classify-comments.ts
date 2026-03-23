import { eq, isNull } from "drizzle-orm";
import { comments, posts } from "@instagram-commenter/core/db";
import { classifyComment } from "@instagram-commenter/core/ai";
import { createCronHandler, log } from "./lib/handler.js";
import { getAnthropicKey } from "./lib/secrets.js";

const BATCH_SIZE = 20;

export const handler = createCronHandler("classify-comments", async (db) => {
  const anthropicKey = getAnthropicKey();

  const pending = await db
    .select({
      id: comments.id,
      text: comments.text,
      likesCount: comments.likesCount,
      authorUsername: comments.authorUsername,
      parentCommentId: comments.parentCommentId,
      postId: comments.postId,
    })
    .from(comments)
    .where(isNull(comments.classificationGroup))
    .limit(BATCH_SIZE);

  if (pending.length === 0) {
    log("info", "No pending comments to classify");
    return;
  }

  log("info", "Classifying comments", { count: pending.length });

  let classified = 0;
  for (const comment of pending) {
    const [post] = await db
      .select({ caption: posts.caption })
      .from(posts)
      .where(eq(posts.id, comment.postId));

    const result = await classifyComment(
      {
        commentText: comment.text,
        postCaption: post?.caption ?? "",
        likesCount: comment.likesCount,
        authorUsername: comment.authorUsername ?? "unknown",
        isTopLevel: !comment.parentCommentId,
      },
      anthropicKey
    );

    await db
      .update(comments)
      .set({
        classificationGroup: result.classification,
        classificationConfidence: result.confidence,
        narrativeTopic: result.narrative_topic ?? null,
        infoType: result.info_type ?? null,
      })
      .where(eq(comments.id, comment.id));

    classified++;
  }

  log("info", "Classification complete", { classified });
});
