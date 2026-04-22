import { eq, and, isNull, inArray } from "drizzle-orm";
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
import { createCronHandler, log } from "./lib/handler.js";
import { getAnthropicKey, getOpenaiKey, getSlackBotToken, getSlackChannelId } from "./lib/secrets.js";

const ACTIONABLE_GROUPS = [
  "narrative_shaping",
  "community_building",
  "informational",
] as const;

export const handler = createCronHandler("allocate-replies", async (db) => {
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

    // Find classified comments that don't have a reply record yet
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
        authorUsername: comments.authorUsername,
      })
      .from(comments)
      .innerJoin(posts, eq(comments.postId, posts.id))
      .leftJoin(replies, eq(comments.id, replies.commentId))
      .where(
        and(
          eq(posts.accountId, account.id),
          inArray(comments.classificationGroup, [...ACTIONABLE_GROUPS]),
          isNull(replies.id)
        )
      )
      .limit(50);

    if (candidates.length === 0) {
      log("info", "No unallocated comments", { accountId: account.id });
      continue;
    }

    const allocated = allocateReplies(
      candidates.map((c) => ({
        id: c.id,
        classificationGroup: c.classificationGroup as (typeof ACTIONABLE_GROUPS)[number],
        likesCount: c.likesCount,
      })),
      remaining
    );

    log("info", "Allocated replies", {
      accountId: account.id,
      candidates: candidates.length,
      allocated: allocated.length,
      remaining,
    });

    const allocatedIds = new Set(allocated.map((item) => item.id));
    for (const candidate of candidates) {
      await recordPipelineEvent(db, {
        commentId: candidate.id,
        stage: "allocate",
        status: allocatedIds.has(candidate.id) ? "succeeded" : "skipped",
        reasonCode: allocatedIds.has(candidate.id) ? "selected_for_generation" : "budget_exhausted",
        payload: {
          classificationGroup: candidate.classificationGroup,
          likesCount: candidate.likesCount,
          remainingBudget: remaining,
        },
      });
    }

    for (const alloc of allocated) {
      const comment = candidates.find((c) => c.id === alloc.id)!;
      try {
        const [post] = await db
          .select({ caption: posts.caption, permalink: posts.permalink })
          .from(posts)
          .where(eq(posts.id, comment.postId));

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

        await recordPipelineEvent(db, {
          commentId: comment.id,
          stage: "retrieve",
          status: retrieval.hasRelevantKnowledge ? "succeeded" : "skipped",
          reasonCode: retrieval.hasRelevantKnowledge ? "knowledge_found" : "no_relevant_knowledge",
          payload: {
            classificationGroup: comment.classificationGroup,
            narrativeTopic: comment.narrativeTopic ?? null,
            infoType: comment.infoType ?? null,
            knowledgeCount: retrieval.knowledge.length,
            exampleCount: retrieval.examples.length,
            topKnowledgeSimilarity: retrieval.knowledge[0]?.similarity ?? null,
            topExampleSimilarity: retrieval.examples[0]?.similarity ?? null,
          },
          latencyMs: Date.now() - retrievalStartedAt,
        });

        if (
          (comment.classificationGroup === "narrative_shaping" ||
            comment.classificationGroup === "informational") &&
          !retrieval.hasRelevantKnowledge
        ) {
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
            postCaption: post?.caption ?? "",
            classificationGroup: comment.classificationGroup as (typeof ACTIONABLE_GROUPS)[number],
            narrativeTopic: comment.narrativeTopic ?? undefined,
            infoType: comment.infoType ?? undefined,
            knowledge: retrieval.knowledge,
            examples: retrieval.examples,
          },
          anthropicKey
        );

        if (result.skip) {
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
            postCaption: post?.caption ?? "",
            postPermalink: post?.permalink ?? undefined,
          },
          {
            id: newReply.id,
            text: result.reply_text,
            classificationGroup: comment.classificationGroup!,
            confidence: comment.classificationConfidence ?? 0,
            narrativeTopic: comment.narrativeTopic ?? undefined,
          },
          post?.caption ?? ""
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
