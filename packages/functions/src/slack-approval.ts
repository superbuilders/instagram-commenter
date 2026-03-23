import { eq } from "drizzle-orm";
import { replies, comments } from "@instagram-commenter/core/db";
import { ingestResponseExample } from "@instagram-commenter/core/knowledge";
import {
  verifySignature,
  updateMessage,
  openModal,
  buildEditModal,
} from "@instagram-commenter/core/slack";
import { createHttpHandler, log } from "./lib/handler.js";
import {
  getSlackSigningSecret,
  getSlackBotToken,
  getOpenaiKey,
  getSlackChannelId,
} from "./lib/secrets.js";

export const handler = createHttpHandler("slack-approval", async (db, body, headers) => {
  const signingSecret = getSlackSigningSecret();
  const timestamp = headers["x-slack-request-timestamp"] ?? "";
  const signature = headers["x-slack-signature"] ?? "";

  if (!verifySignature(body, timestamp, signature, signingSecret)) {
    return { statusCode: 401, body: "Invalid signature" };
  }

  const params = new URLSearchParams(body);
  const payloadStr = params.get("payload");
  if (!payloadStr) return { statusCode: 400, body: "Missing payload" };

  const payload = JSON.parse(payloadStr) as {
    type: string;
    trigger_id: string;
    channel: { id: string };
    message: { ts: string };
    actions?: Array<{ action_id: string; value: string }>;
    view?: {
      callback_id: string;
      private_metadata: string;
      state: { values: Record<string, Record<string, { value: string }>> };
    };
    user: { id: string; username: string };
  };

  const slackToken = getSlackBotToken();
  const openaiKey = getOpenaiKey();
  const channelId = getSlackChannelId();

  // Handle button interactions
  if (payload.type === "block_actions" && payload.actions) {
    const action = payload.actions[0];
    const data = JSON.parse(action.value);

    if (action.action_id === "approve") {
      const [reply] = await db
        .select()
        .from(replies)
        .where(eq(replies.id, data.replyId));

      await db
        .update(replies)
        .set({
          approvalStatus: "approved",
          approvedBy: payload.user.username,
          approvedAt: new Date(),
        })
        .where(eq(replies.id, data.replyId));

      // Feedback loop: store as positive example
      const [comment] = await db
        .select()
        .from(comments)
        .where(eq(comments.id, data.commentId));

      if (comment && reply) {
        await ingestResponseExample(
          comment.text,
          reply.originalText,
          true,
          "slack_approved",
          comment.classificationGroup,
          { db, openaiApiKey: openaiKey }
        );
      }

      await updateMessage(
        channelId,
        payload.message.ts,
        [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `✅ *Approved* by @${payload.user.username}`,
            },
          },
        ],
        "Reply approved",
        slackToken
      );

      log("info", "Reply approved", {
        replyId: data.replyId,
        by: payload.user.username,
      });
    }

    if (action.action_id === "edit") {
      const modal = buildEditModal(data.replyId, data.originalText);
      await openModal(payload.trigger_id, modal, slackToken);
    }

    if (action.action_id === "reject") {
      await db
        .update(replies)
        .set({ approvalStatus: "rejected" })
        .where(eq(replies.id, data.replyId));

      // Feedback loop: store as negative example
      const [reply] = await db
        .select()
        .from(replies)
        .where(eq(replies.id, data.replyId));
      const [comment] = await db
        .select()
        .from(comments)
        .where(eq(comments.id, data.commentId));

      if (comment && reply) {
        await ingestResponseExample(
          comment.text,
          reply.originalText,
          false,
          "slack_rejected",
          comment.classificationGroup,
          { db, openaiApiKey: openaiKey }
        );
      }

      await updateMessage(
        channelId,
        payload.message.ts,
        [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `❌ *Rejected* by @${payload.user.username}`,
            },
          },
        ],
        "Reply rejected",
        slackToken
      );

      log("info", "Reply rejected", {
        replyId: data.replyId,
        by: payload.user.username,
      });
    }

    // Deletion actions
    if (action.action_id === "confirm_delete") {
      await db
        .update(comments)
        .set({
          deletedAt: new Date(),
          deletedBy: `slack:${payload.user.username}`,
        })
        .where(eq(comments.id, data.commentId));

      await updateMessage(
        channelId,
        payload.message.ts,
        [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `🗑️ *Deleted* by @${payload.user.username}`,
            },
          },
        ],
        "Comment deleted",
        slackToken
      );
    }

    if (action.action_id === "skip_delete") {
      await db
        .update(comments)
        .set({ classificationGroup: "skip" })
        .where(eq(comments.id, data.commentId));

      await updateMessage(
        channelId,
        payload.message.ts,
        [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `⏭️ *Skipped* by @${payload.user.username} (comment stands)`,
            },
          },
        ],
        "Delete skipped",
        slackToken
      );
    }
  }

  // Handle modal submission (edit flow)
  if (payload.type === "view_submission" && payload.view) {
    const { callback_id, private_metadata, state } = payload.view;

    if (callback_id === "edit_reply") {
      const { replyId } = JSON.parse(private_metadata);
      const editedText =
        state.values.reply_text_block.reply_text.value;

      const [reply] = await db
        .select()
        .from(replies)
        .where(eq(replies.id, replyId));

      // Store original as negative, edited as positive
      if (reply) {
        const [comment] = await db
          .select()
          .from(comments)
          .where(eq(comments.id, reply.commentId));

        if (comment) {
          await ingestResponseExample(
            comment.text,
            reply.originalText,
            false,
            "slack_edited",
            comment.classificationGroup,
            { db, openaiApiKey: openaiKey }
          );
          await ingestResponseExample(
            comment.text,
            editedText,
            true,
            "slack_edited",
            comment.classificationGroup,
            { db, openaiApiKey: openaiKey }
          );
        }
      }

      await db
        .update(replies)
        .set({
          editedText,
          approvalStatus: "approved",
          approvedBy: payload.user.username,
          approvedAt: new Date(),
        })
        .where(eq(replies.id, replyId));

      log("info", "Reply edited and approved", {
        replyId,
        by: payload.user.username,
      });
    }
  }

  return { statusCode: 200, body: "" };
});
