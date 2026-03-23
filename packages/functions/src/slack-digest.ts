import { eq, and, gte, lte, sql, count } from "drizzle-orm";
import { comments, replies, dailyBudgets, accounts } from "@instagram-commenter/core/db";
import { postMessage, buildDigestMessage } from "@instagram-commenter/core/slack";
import { createCronHandler, log } from "./lib/handler.js";
import { getSlackBotToken, getSlackChannelId } from "./lib/secrets.js";

export const handler = createCronHandler("slack-digest", async (db) => {
  const slackToken = getSlackBotToken();
  const channelId = getSlackChannelId();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split("T")[0];

  const startOfDay = new Date(`${dateStr}T00:00:00Z`);
  const endOfDay = new Date(`${dateStr}T23:59:59Z`);

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

  // Build and send digest
  const msg = buildDigestMessage({
    date: dateStr,
    totalComments,
    classifications,
    repliesPosted: totalPosted,
    repliesApproved: approvalMap["approved"] ?? 0,
    repliesEdited: 0, // TODO: track edits separately
    repliesRejected: approvalMap["rejected"] ?? 0,
    repliesAuto: approvalMap["auto"] ?? 0,
    deletionsExecuted: Number(deleteResult?.count ?? 0),
    budgetUtilization: totalBudget > 0 ? totalPosted / totalBudget : 0,
    gapTopics: [], // TODO: implement gap detection
  });

  await postMessage(channelId, msg.blocks, msg.text, slackToken);
  log("info", "Digest posted", { date: dateStr });
});
