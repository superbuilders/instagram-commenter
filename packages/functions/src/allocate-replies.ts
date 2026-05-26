import { eq, and, isNull, inArray, desc } from "drizzle-orm";
import { comments, posts, replies, accounts } from "@instagram-commenter/core/db";
import { generateReply, verifyReply } from "@instagram-commenter/core/ai";
import { retrieveForComment } from "@instagram-commenter/core/knowledge";
import {
  GENERATOR_MODEL,
  GENERATOR_PROMPT_VERSION,
  VERIFIER_MODEL,
  VERIFIER_PROMPT_VERSION,
  recordPipelineEvent,
} from "@instagram-commenter/core/pipeline";
import {
  getRemainingBudget,
  incrementAllocated,
  allocateReplies,
} from "@instagram-commenter/core/scheduling";
import { postMessage, buildApprovalMessage } from "@instagram-commenter/core/slack";
import { APP_TIME_ZONE, getLocalHour } from "@instagram-commenter/core/time";
import { createCronHandler, log } from "./lib/handler.js";
import { getAnthropicKey, getOpenaiKey, getSlackBotToken, getSlackChannelId } from "./lib/secrets.js";

const ACTIONABLE_GROUPS = [
  "narrative_shaping",
  "community_building",
  "informational",
] as const;

const CANDIDATE_SCAN_LIMIT = 500;
const REVIEW_WINDOW_START_LOCAL_HOUR = 7;
const REVIEW_WINDOW_END_LOCAL_HOUR = 19;

export const handler = createCronHandler("allocate-replies", async (db) => {
  const localHour = getLocalHour();
  if (
    localHour < REVIEW_WINDOW_START_LOCAL_HOUR ||
    localHour >= REVIEW_WINDOW_END_LOCAL_HOUR
  ) {
    log("info", "Skipping reply allocation outside review window", {
      timeZone: APP_TIME_ZONE,
      localHour,
      reviewWindowStartLocalHour: REVIEW_WINDOW_START_LOCAL_HOUR,
      reviewWindowEndLocalHour: REVIEW_WINDOW_END_LOCAL_HOUR,
    });
    return;
  }

  const anthropicKey = getAnthropicKey();
  const openaiKey = getOpenaiKey();
  const slackToken = getSlackBotToken();
  const channelId = getSlackChannelId();

  const allAccounts = await db.select().from(accounts);

  for (const account of allAccounts) {
    const remaining = await getRemainingBudget(account.id, db);
    if (remaining <= 0) {
      log("info", "Budget exhausted", { accountId: account.id });
      continue;
    }

    // Find classified comments that don't have a reply record yet and have not
    // already reached a terminal skip state.
    const candidates = await db
      .select({
        id: comments.id,
        text: comments.text,
        classificationGroup: comments.classificationGroup,
        classificationConfidence: comments.classificationConfidence,
        likesCount: comments.likesCount,
        narrativeTopic: comments.narrativeTopic,
        infoType: comments.infoType,
        postId: comments.postId,
        postCaption: posts.caption,
        postPermalink: posts.permalink,
        authorUsername: comments.authorUsername,
      })
      .from(comments)
      .innerJoin(posts, eq(comments.postId, posts.id))
      .leftJoin(replies, eq(comments.id, replies.commentId))
      .where(
        and(
          eq(posts.accountId, account.id),
          inArray(comments.classificationGroup, [...ACTIONABLE_GROUPS]),
          isNull(replies.id),
          isNull(comments.skipReason)
        )
      )
      .orderBy(desc(comments.likesCount), desc(comments.createdAt))
      .limit(CANDIDATE_SCAN_LIMIT);

    if (candidates.length === 0) {
      log("info", "No unallocated comments", { accountId: account.id });
      continue;
    }

    const allocated = allocateReplies(
      candidates.map((c) => ({
        id: c.id,
        classificationGroup: c.classificationGroup as (typeof ACTIONABLE_GROUPS)[number],
        likesCount: c.likesCount,
        text: c.text,
        postCaption: c.postCaption,
        classificationConfidence: c.classificationConfidence,
        narrativeTopic: c.narrativeTopic,
        infoType: c.infoType,
      })),
      remaining
    );

    log("info", "Allocated replies", {
      accountId: account.id,
      candidates: candidates.length,
      allocated: allocated.length,
      remaining,
    });

    for (const candidate of allocated) {
      const selected = candidates.find((c) => c.id === candidate.id)!;
      await recordPipelineEvent(db, {
        commentId: selected.id,
        stage: "allocate",
        status: "succeeded",
        reasonCode: "selected_for_generation",
        payload: {
          classificationGroup: selected.classificationGroup,
          likesCount: selected.likesCount,
          allocationScore: candidate.allocationScore,
          allocationReasons: candidate.allocationReasons,
          remainingBudget: remaining,
        },
      });
    }

    for (const alloc of allocated) {
      const comment = candidates.find((c) => c.id === alloc.id)!;
      try {
        const postCaption = comment.postCaption ?? "";

        const retrievalStartedAt = Date.now();
        await recordPipelineEvent(db, {
          commentId: comment.id,
          stage: "retrieve",
          status: "started",
        });

        const retrieval = await retrieveForComment(
          comment.text,
          comment.classificationGroup!,
          comment.narrativeTopic ?? null,
          { db, openaiApiKey: openaiKey }
        );

        const requiresKnowledge =
          comment.classificationGroup === "narrative_shaping" ||
          comment.classificationGroup === "informational";
        const learnedSkipMatch = retrieval.learnedSkipMatch;
        const retrievalSkipped =
          learnedSkipMatch != null ||
          (requiresKnowledge && !retrieval.hasRelevantKnowledge);
        const retrievalReasonCode = learnedSkipMatch
          ? "learned_negative_feedback_match"
          : retrieval.hasRelevantKnowledge
            ? "knowledge_found"
            : requiresKnowledge
              ? "no_relevant_knowledge"
              : "knowledge_not_required";

        await recordPipelineEvent(db, {
          commentId: comment.id,
          stage: "retrieve",
          status: retrievalSkipped ? "skipped" : "succeeded",
          reasonCode: retrievalReasonCode,
          payload: {
            classificationGroup: comment.classificationGroup,
            narrativeTopic: comment.narrativeTopic ?? null,
            infoType: comment.infoType ?? null,
            knowledgeCount: retrieval.knowledge.length,
            positiveExampleCount: retrieval.positiveExamples.length,
            negativeExampleCount: retrieval.negativeExamples.length,
            topKnowledgeSimilarity: retrieval.knowledge[0]?.similarity ?? null,
            topPositiveExampleSimilarity: retrieval.positiveExamples[0]?.similarity ?? null,
            topNegativeExampleSimilarity: retrieval.negativeExamples[0]?.similarity ?? null,
            learnedSkipMatch: learnedSkipMatch
              ? {
                  id: learnedSkipMatch.id,
                  similarity: learnedSkipMatch.similarity,
                  reviewReason: learnedSkipMatch.reviewReason,
                  reviewNotes: learnedSkipMatch.reviewNotes,
                }
              : null,
          },
          latencyMs: Date.now() - retrievalStartedAt,
        });

        if (learnedSkipMatch) {
          await db
            .update(comments)
            .set({ skipReason: "learned_should_not_reply" })
            .where(eq(comments.id, comment.id));

          log("info", "Skipping due to similar rejected feedback", {
            commentId: comment.id,
            negativeExampleId: learnedSkipMatch.id,
            similarity: learnedSkipMatch.similarity,
            reviewReason: learnedSkipMatch.reviewReason,
          });
          continue;
        }

        if (requiresKnowledge && !retrieval.hasRelevantKnowledge) {
          await db
            .update(comments)
            .set({ skipReason: "no_relevant_knowledge" })
            .where(eq(comments.id, comment.id));

          log("info", `Skipping — no relevant knowledge for ${comment.classificationGroup}`, {
            commentId: comment.id,
          });
          continue;
        }

        const generationStartedAt = Date.now();
        await recordPipelineEvent(db, {
          commentId: comment.id,
          stage: "generate",
          status: "started",
          model: GENERATOR_MODEL,
          promptVersion: GENERATOR_PROMPT_VERSION,
        });

        const result = await generateReply(
          {
            commentText: comment.text,
            postCaption,
            classificationGroup: comment.classificationGroup as (typeof ACTIONABLE_GROUPS)[number],
            narrativeTopic: comment.narrativeTopic ?? undefined,
            infoType: comment.infoType ?? undefined,
            knowledge: retrieval.knowledge,
            examples: retrieval.positiveExamples,
            negativeExamples: retrieval.negativeExamples,
          },
          anthropicKey
        );

        if (result.skip) {
          await db
            .update(comments)
            .set({ skipReason: "generator_skip" })
            .where(eq(comments.id, comment.id));

          await recordPipelineEvent(db, {
            commentId: comment.id,
            stage: "generate",
            status: "skipped",
            reasonCode: "generator_skip",
            reasonDetail: result.reason,
            model: GENERATOR_MODEL,
            promptVersion: GENERATOR_PROMPT_VERSION,
            latencyMs: Date.now() - generationStartedAt,
          });

          log("info", "Generator skipped", {
            commentId: comment.id,
            reason: result.reason,
          });
          continue;
        }

        await recordPipelineEvent(db, {
          commentId: comment.id,
          stage: "generate",
          status: "succeeded",
          reasonCode: "reply_generated",
          payload: { replyLength: result.reply_text.length },
          model: GENERATOR_MODEL,
          promptVersion: GENERATOR_PROMPT_VERSION,
          latencyMs: Date.now() - generationStartedAt,
        });

        const verificationStartedAt = Date.now();
        await recordPipelineEvent(db, {
          commentId: comment.id,
          stage: "verify",
          status: "started",
          model: VERIFIER_MODEL,
          promptVersion: VERIFIER_PROMPT_VERSION,
        });

        const verification = await verifyReply(
          result.reply_text,
          retrieval.knowledge,
          anthropicKey
        );

        if (!verification.verified) {
          await db
            .update(comments)
            .set({ skipReason: "verification_failed" })
            .where(eq(comments.id, comment.id));

          await recordPipelineEvent(db, {
            commentId: comment.id,
            stage: "verify",
            status: "failed",
            reasonCode: "verification_failed",
            reasonDetail: verification.issues.join("; "),
            payload: { issues: verification.issues },
            model: VERIFIER_MODEL,
            promptVersion: VERIFIER_PROMPT_VERSION,
            latencyMs: Date.now() - verificationStartedAt,
          });

          log("warn", "Reply failed fact-check — skipping", {
            commentId: comment.id,
            issues: verification.issues,
          });
          continue;
        }

        await recordPipelineEvent(db, {
          commentId: comment.id,
          stage: "verify",
          status: "succeeded",
          reasonCode: "verified",
          model: VERIFIER_MODEL,
          promptVersion: VERIFIER_PROMPT_VERSION,
          latencyMs: Date.now() - verificationStartedAt,
        });

        const [newReply] = await db
          .insert(replies)
          .values({
            commentId: comment.id,
            originalText: result.reply_text,
            approvalStatus: "pending",
            promptVersion: GENERATOR_PROMPT_VERSION,
          })
          .returning();

        const slackMsg = buildApprovalMessage(
          {
            id: comment.id,
            text: comment.text,
            authorUsername: comment.authorUsername ?? "unknown",
            likesCount: comment.likesCount,
            postCaption,
            postPermalink: comment.postPermalink ?? undefined,
          },
          {
            id: newReply.id,
            text: result.reply_text,
            classificationGroup: comment.classificationGroup!,
            confidence: comment.classificationConfidence ?? 0,
            narrativeTopic: comment.narrativeTopic ?? undefined,
            infoType: comment.infoType ?? undefined,
            allocationScore: alloc.allocationScore,
            allocationReasons: alloc.allocationReasons,
            knowledgeCount: retrieval.knowledge.length,
            topKnowledgeSimilarity: retrieval.knowledge[0]?.similarity ?? null,
            positiveExampleCount: retrieval.positiveExamples.length,
            topPositiveExampleSimilarity: retrieval.positiveExamples[0]?.similarity ?? null,
            negativeExampleCount: retrieval.negativeExamples.length,
            topNegativeExampleSimilarity: retrieval.negativeExamples[0]?.similarity ?? null,
            negativeWarningReason: retrieval.negativeExamples[0]?.reviewReason ?? null,
          },
          postCaption
        );

        const ts = await postMessage(
          channelId,
          slackMsg.blocks,
          slackMsg.text,
          slackToken
        );

        await db
          .update(replies)
          .set({ slackMessageTs: ts })
          .where(eq(replies.id, newReply.id));

        await recordPipelineEvent(db, {
          commentId: comment.id,
          replyId: newReply.id,
          stage: "slack_review",
          status: "succeeded",
          reasonCode: "sent_for_review",
          payload: { slackMessageTs: ts },
        });

        await incrementAllocated(
          account.id,
          comment.classificationGroup as (typeof ACTIONABLE_GROUPS)[number],
          db
        );
      } catch (err) {
        await recordPipelineEvent(db, {
          commentId: comment.id,
          stage: "generate",
          status: "failed",
          reasonCode: "allocation_pipeline_error",
          reasonDetail: err instanceof Error ? err.message : String(err),
        });

        log("error", "Reply allocation failed for comment", {
          accountId: account.id,
          commentId: comment.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
});
