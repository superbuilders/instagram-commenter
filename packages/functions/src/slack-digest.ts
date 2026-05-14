import { eq, and, gte, lte, sql, count, desc } from "drizzle-orm";
import { comments, replies, dailyBudgets, evalResults, commentPipelineEvents } from "@instagram-commenter/core/db";
import { postMessage, buildDigestMessage } from "@instagram-commenter/core/slack";
import {
  APP_TIME_ZONE,
  addDaysToLocalDateString,
  getLocalDateRangeUtc,
  getLocalDateString,
  getLocalHour,
} from "@instagram-commenter/core/time";
import { createCronHandler, log } from "./lib/handler.js";
import { getSlackBotToken, getSlackChannelId } from "./lib/secrets.js";

const DIGEST_LOCAL_HOUR = 9;

export const handler = createCronHandler("slack-digest", async (db) => {
  const localHour = getLocalHour();
  if (localHour !== DIGEST_LOCAL_HOUR) {
    log("info", "Skipping digest outside scheduled local hour", {
      timeZone: APP_TIME_ZONE,
      localHour,
      scheduledLocalHour: DIGEST_LOCAL_HOUR,
    });
    return;
  }

  const slackToken = getSlackBotToken();
  const channelId = getSlackChannelId();

  const dateStr = addDaysToLocalDateString(getLocalDateString(), -1);
  const { start: startOfDay, end: endOfDay } = getLocalDateRangeUtc(dateStr);

  // Get budget stats
  const budgets = await db
    .select()
    .from(dailyBudgets)
    .where(eq(dailyBudgets.budgetDate, dateStr));

  const totalComments = budgets.reduce(
    (sum, b) => sum + b.totalCommentsSeen,
    0
  );
  const totalPosted = budgets.reduce((sum, b) => sum + b.repliesPosted, 0);
  const totalBudget = budgets.reduce((sum, b) => sum + b.budgetLimit, 0);

  // Classification breakdown
  const classBreakdown = await db
    .select({
      group: comments.classificationGroup,
      count: count(),
    })
    .from(comments)
    .where(
      and(
        gte(comments.createdAt, startOfDay),
        lte(comments.createdAt, endOfDay)
      )
    )
    .groupBy(comments.classificationGroup);

  const classifications: Record<string, number> = {};
  for (const row of classBreakdown) {
    classifications[row.group ?? "unclassified"] = Number(row.count);
  }

  // Approval stats
  const approvalBreakdown = await db
    .select({
      status: replies.approvalStatus,
      count: count(),
    })
    .from(replies)
    .where(
      and(
        gte(replies.createdAt, startOfDay),
        lte(replies.createdAt, endOfDay)
      )
    )
    .groupBy(replies.approvalStatus);

  const approvalMap: Record<string, number> = {};
  for (const row of approvalBreakdown) {
    approvalMap[row.status] = Number(row.count);
  }

  const rejectReasonBreakdown = await db
    .select({
      reason: replies.reviewOutcomeReason,
      count: count(),
    })
    .from(replies)
    .where(
      and(
        gte(replies.createdAt, startOfDay),
        lte(replies.createdAt, endOfDay),
        eq(replies.approvalStatus, "rejected")
      )
    )
    .groupBy(replies.reviewOutcomeReason);

  const topRejectReasons = rejectReasonBreakdown
    .map((row) => ({
      reason: row.reason ?? "unspecified",
      count: Number(row.count),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const pipelineIssueBreakdown = await db
    .select({
      stage: commentPipelineEvents.stage,
      status: commentPipelineEvents.status,
      reasonCode: commentPipelineEvents.reasonCode,
      eventCount: count(),
      commentCount: sql<number>`COUNT(DISTINCT ${commentPipelineEvents.commentId})`,
    })
    .from(commentPipelineEvents)
    .where(
      and(
        gte(commentPipelineEvents.createdAt, startOfDay),
        lte(commentPipelineEvents.createdAt, endOfDay),
        sql`${commentPipelineEvents.status} IN ('failed', 'skipped')`
      )
    )
    .groupBy(
      commentPipelineEvents.stage,
      commentPipelineEvents.status,
      commentPipelineEvents.reasonCode
    );

  const pipelineIssues = pipelineIssueBreakdown
    .map((row) => ({
      label: `${row.stage.replace(/_/g, " ")} / ${(row.reasonCode ?? row.status).replace(/_/g, " ")}`,
      eventCount: Number(row.eventCount),
      commentCount: Number(row.commentCount),
    }))
    .sort((a, b) => b.commentCount - a.commentCount || b.eventCount - a.eventCount)
    .slice(0, 6);

  const gapTopicBreakdown = await db
    .select({
      topic: sql<string>`COALESCE(${commentPipelineEvents.payload}->>'narrativeTopic', ${commentPipelineEvents.payload}->>'infoType', ${commentPipelineEvents.payload}->>'classificationGroup', 'general')`,
      eventCount: count(),
      commentCount: sql<number>`COUNT(DISTINCT ${commentPipelineEvents.commentId})`,
    })
    .from(commentPipelineEvents)
    .where(
      and(
        gte(commentPipelineEvents.createdAt, startOfDay),
        lte(commentPipelineEvents.createdAt, endOfDay),
        eq(commentPipelineEvents.reasonCode, "no_relevant_knowledge"),
        sql`COALESCE(${commentPipelineEvents.payload}->>'classificationGroup', '') <> 'community_building'`
      )
    )
    .groupBy(
      sql`COALESCE(${commentPipelineEvents.payload}->>'narrativeTopic', ${commentPipelineEvents.payload}->>'infoType', ${commentPipelineEvents.payload}->>'classificationGroup', 'general')`
    );

  const gapTopics = gapTopicBreakdown
    .map((row) => ({
      topic: row.topic,
      eventCount: Number(row.eventCount),
      commentCount: Number(row.commentCount),
    }))
    .sort((a, b) => b.commentCount - a.commentCount || b.eventCount - a.eventCount)
    .slice(0, 5);

  // Deletion count
  const [deleteResult] = await db
    .select({ count: count() })
    .from(comments)
    .where(
      and(
        gte(comments.deletedAt, startOfDay),
        lte(comments.deletedAt, endOfDay)
      )
    );

  // Get latest eval results
  const latestEval = await db
    .select()
    .from(evalResults)
    .where(eq(evalResults.evalType, "classification"))
    .orderBy(desc(evalResults.evalDate))
    .limit(1);

  const evalScore = latestEval[0]
    ? {
        accuracy: Math.round((latestEval[0].classificationAccuracy ?? 0) * 100),
        date: latestEval[0].evalDate,
      }
    : null;

  // Build and send digest
  const msg = buildDigestMessage({
    date: dateStr,
    timeZone: APP_TIME_ZONE,
    totalComments,
    classifications,
    repliesPosted: totalPosted,
    repliesApproved: approvalMap["approved"] ?? 0,
    repliesEdited: 0, // TODO: track edits separately
    repliesRejected: approvalMap["rejected"] ?? 0,
    repliesAuto: approvalMap["auto"] ?? 0,
    deletionsExecuted: Number(deleteResult?.count ?? 0),
    budgetUtilization: totalBudget > 0 ? totalPosted / totalBudget : 0,
    gapTopics,
    topRejectReasons,
    pipelineIssues,
    evalScore,
  });

  await postMessage(channelId, msg.blocks, msg.text, slackToken);
  log("info", "Digest posted", { date: dateStr });
});
