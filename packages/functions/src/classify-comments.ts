import { eq, isNull } from "drizzle-orm";
import { comments, posts } from "@instagram-commenter/core/db";
import { classifyComment } from "@instagram-commenter/core/ai";
import {
  CLASSIFIER_MODEL,
  CLASSIFIER_POLICY_VERSION,
  CLASSIFIER_PROMPT_VERSION,
  recordPipelineEvent,
} from "@instagram-commenter/core/pipeline";
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
    const startedAt = Date.now();
    await recordPipelineEvent(db, {
      commentId: comment.id,
      stage: "classify",
      status: "started",
      model: CLASSIFIER_MODEL,
      promptVersion: CLASSIFIER_PROMPT_VERSION,
    });

    try {
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
          skipReason: result.skip_reason ?? null,
          deleteReason: result.delete_reason ?? null,
          classificationPolicyVersion: result.policy_version ?? CLASSIFIER_POLICY_VERSION,
          classificationRationaleTags: result.rationale_tags ?? null,
        })
        .where(eq(comments.id, comment.id));

      await recordPipelineEvent(db, {
        commentId: comment.id,
        stage: "classify",
        status: "succeeded",
        reasonCode: result.classification,
        payload: {
          confidence: result.confidence,
          narrativeTopic: result.narrative_topic ?? null,
          infoType: result.info_type ?? null,
          skipReason: result.skip_reason ?? null,
          deleteReason: result.delete_reason ?? null,
          rationaleTags: result.rationale_tags ?? [],
        },
        model: CLASSIFIER_MODEL,
        promptVersion: CLASSIFIER_PROMPT_VERSION,
        latencyMs: Date.now() - startedAt,
      });

      classified++;
    } catch (err) {
      await recordPipelineEvent(db, {
        commentId: comment.id,
        stage: "classify",
        status: "failed",
        reasonCode: "classifier_error",
        reasonDetail: err instanceof Error ? err.message : String(err),
        model: CLASSIFIER_MODEL,
        promptVersion: CLASSIFIER_PROMPT_VERSION,
        latencyMs: Date.now() - startedAt,
      });

      log("error", "Comment classification failed", {
        commentId: comment.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log("info", "Classification complete", { classified });
});
