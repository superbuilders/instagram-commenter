import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { comments, posts, replies, accounts } from "@instagram-commenter/core/db";
import { generateReply } from "@instagram-commenter/core/ai";
import { retrieveForComment } from "@instagram-commenter/core/knowledge";
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
        likesCount: comments.likesCount,
        narrativeTopic: comments.narrativeTopic,
        infoType: comments.infoType,
        postId: comments.postId,
        authorUsername: comments.authorUsername,
      })
      .from(comments)
      .leftJoin(replies, eq(comments.id, replies.commentId))
      .where(
        and(
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

    for (const alloc of allocated) {
      const comment = candidates.find((c) => c.id === alloc.id)!;

      const [post] = await db
        .select({ caption: posts.caption })
        .from(posts)
        .where(eq(posts.id, comment.postId));

      // Retrieve knowledge
      const retrieval = await retrieveForComment(
        comment.text,
        comment.classificationGroup!,
        comment.narrativeTopic ?? null,
        { db, openaiApiKey: openaiKey }
      );

      // Skip narrative shaping if no relevant knowledge
      if (
        comment.classificationGroup === "narrative_shaping" &&
        !retrieval.hasRelevantKnowledge
      ) {
        log("info", "Skipping — no relevant knowledge for narrative", {
          commentId: comment.id,
        });
        continue;
      }

      // Generate reply
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
        log("info", "Generator skipped", {
          commentId: comment.id,
          reason: result.reason,
        });
        continue;
      }

      // Insert reply
      const [newReply] = await db
        .insert(replies)
        .values({
          commentId: comment.id,
          originalText: result.reply_text,
          approvalStatus: "pending",
        })
        .returning();

      // Send to Slack for approval
      const slackMsg = buildApprovalMessage(
        {
          id: comment.id,
          text: comment.text,
          authorUsername: comment.authorUsername ?? "unknown",
          likesCount: comment.likesCount,
          postCaption: post?.caption ?? "",
        },
        {
          id: newReply.id,
          text: result.reply_text,
          classificationGroup: comment.classificationGroup!,
          confidence: 0.9,
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

      await incrementAllocated(
        account.id,
        comment.classificationGroup as (typeof ACTIONABLE_GROUPS)[number],
        db
      );
    }
  }
});
