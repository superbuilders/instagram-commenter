import { eq } from "drizzle-orm";
import { replies, comments, posts, accounts } from "@instagram-commenter/core/db";
import { ingestResponseExample } from "@instagram-commenter/core/knowledge";
import {
  CLASSIFIER_POLICY_VERSION,
  getReviewOutcomeCategory,
  recordPipelineEvent,
} from "@instagram-commenter/core/pipeline";
import { deleteComment } from "@instagram-commenter/core/instagram";
import { decrementPending } from "@instagram-commenter/core/scheduling";
import {
  buildEditModal,
  buildHandledReplyMessage,
  buildRejectModal,
  verifySignature,
  updateMessage,
  openModal,
} from "@instagram-commenter/core/slack";
import { createHttpHandler, log } from "./lib/handler.js";
import {
  getSlackSigningSecret,
  getSlackBotToken,
  getOpenaiKey,
  getSlackChannelId,
} from "./lib/secrets.js";

type SlackStateValue = {
  value?: string;
  selected_option?: { value: string };
};

type SlackPayload = {
  type: string;
  trigger_id: string;
  channel: { id: string };
  message: { ts: string };
  actions?: Array<{ action_id: string; value: string }>;
  view?: {
    callback_id: string;
    private_metadata: string;
    state: { values: Record<string, Record<string, SlackStateValue>> };
  };
  user: { id: string; username?: string; name?: string };
};

function getReviewer(payload: SlackPayload): { display: string; storageValue: string } {
  return {
    display: `<@${payload.user.id}>`,
    storageValue: payload.user.username ?? payload.user.name ?? payload.user.id,
  };
}

function readSelectedValue(
  state: Record<string, Record<string, SlackStateValue>>,
  blockId: string,
  actionId: string
): string | null {
  const field = state[blockId]?.[actionId];
  return field?.selected_option?.value ?? field?.value ?? null;
}

async function getAccountForComment(db: any, commentId: string) {
  const [comment] = await db
    .select({
      id: comments.id,
      text: comments.text,
      classificationGroup: comments.classificationGroup,
      platformCommentId: comments.platformCommentId,
      postId: comments.postId,
    })
    .from(comments)
    .where(eq(comments.id, commentId));

  if (!comment) return { comment: null, account: null };

  const [post] = await db
    .select({ accountId: posts.accountId })
    .from(posts)
    .where(eq(posts.id, comment.postId));

  if (!post) return { comment, account: null };

  const [account] = await db
    .select({ id: accounts.id, accessToken: accounts.accessToken })
    .from(accounts)
    .where(eq(accounts.id, post.accountId));

  return { comment, account };
}

async function getHandledReplyContext(db: any, replyId: string) {
  const [row] = await db
    .select({
      replyId: replies.id,
      originalText: replies.originalText,
      editedText: replies.editedText,
      commentId: comments.id,
      commentText: comments.text,
      authorUsername: comments.authorUsername,
      likesCount: comments.likesCount,
      postCaption: posts.caption,
      postPermalink: posts.permalink,
    })
    .from(replies)
    .innerJoin(comments, eq(replies.commentId, comments.id))
    .innerJoin(posts, eq(comments.postId, posts.id))
    .where(eq(replies.id, replyId));

  if (!row) return null;

  return {
    originalReply: row.originalText,
    finalReply: row.editedText ?? row.originalText,
    comment: {
      id: row.commentId,
      text: row.commentText,
      authorUsername: row.authorUsername ?? "unknown",
      likesCount: row.likesCount,
      postCaption: row.postCaption ?? "",
      postPermalink: row.postPermalink ?? undefined,
    },
  };
}

async function getReplyById(db: any, replyId: string) {
  const [reply] = await db
    .select()
    .from(replies)
    .where(eq(replies.id, replyId));
  return reply ?? null;
}

function isPendingReply(reply: { approvalStatus: string } | null): boolean {
  return reply?.approvalStatus === "pending";
}

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

  const payload = JSON.parse(payloadStr) as SlackPayload;

  const slackToken = getSlackBotToken();
  const openaiKey = getOpenaiKey();
  const channelId = getSlackChannelId();
  const reviewer = getReviewer(payload);

  if (payload.type === "block_actions" && payload.actions) {
    const action = payload.actions[0];
    const data = JSON.parse(action.value);

    if (action.action_id === "approve") {
      const reply = await getReplyById(db, data.replyId);
      if (!isPendingReply(reply)) {
        log("info", "Ignoring approve action for non-pending reply", {
          replyId: data.replyId,
          status: reply?.approvalStatus ?? "missing",
        });
        return { statusCode: 200, body: "" };
      }

      const [comment] = await db
        .select()
        .from(comments)
        .where(eq(comments.id, data.commentId));

      await db
        .update(replies)
        .set({
          approvalStatus: "approved",
          approvedBy: reviewer.storageValue,
          approvedAt: new Date(),
          reviewOutcomeReason: "approved",
          reviewOutcomeCategory: "operator",
          reviewOutcomeNotes: null,
        })
        .where(eq(replies.id, data.replyId));

      if (comment && reply) {
        await ingestResponseExample(
          comment.text,
          reply.originalText,
          true,
          "slack_approved",
          comment.classificationGroup,
          {
            reviewReason: "approved",
            originalReplyId: reply.id,
            policyVersion: CLASSIFIER_POLICY_VERSION,
          },
          { db, openaiApiKey: openaiKey }
        );

        await recordPipelineEvent(db, {
          commentId: comment.id,
          replyId: reply.id,
          stage: "slack_review",
          status: "succeeded",
          reasonCode: "slack_approved",
          payload: {
            reviewer: reviewer.storageValue,
            reviewerSlackUserId: payload.user.id,
          },
        });
      }

      const handledContext = await getHandledReplyContext(db, data.replyId);
      const handledMessage = buildHandledReplyMessage({
        outcome: "approved",
        reviewer: reviewer.display,
        ...(handledContext ?? {
          originalReply: reply?.originalText ?? "Approved reply unavailable",
          comment: {
            id: data.commentId,
            text: comment?.text ?? "Original comment unavailable",
            authorUsername: comment?.authorUsername ?? "unknown",
            likesCount: comment?.likesCount ?? 0,
            postCaption: "",
          },
        }),
      });

      await updateMessage(
        channelId,
        payload.message.ts,
        handledMessage.blocks,
        handledMessage.text,
        slackToken
      );

      log("info", "Reply approved", {
        replyId: data.replyId,
        by: reviewer.storageValue,
        slackUserId: payload.user.id,
      });
    }

    if (action.action_id === "edit") {
      const reply = await getReplyById(db, data.replyId);
      if (!isPendingReply(reply)) {
        log("info", "Ignoring edit action for non-pending reply", {
          replyId: data.replyId,
          status: reply?.approvalStatus ?? "missing",
        });
        return { statusCode: 200, body: "" };
      }

      const modal = buildEditModal(data.replyId, data.originalText) as Record<string, unknown>;
      modal.private_metadata = JSON.stringify({
        replyId: data.replyId,
        commentId: data.commentId,
        messageTs: payload.message.ts,
        channelId,
      });
      await openModal(payload.trigger_id, modal, slackToken);
    }

    if (action.action_id === "reject") {
      const reply = await getReplyById(db, data.replyId);
      if (!isPendingReply(reply)) {
        log("info", "Ignoring reject action for non-pending reply", {
          replyId: data.replyId,
          status: reply?.approvalStatus ?? "missing",
        });
        return { statusCode: 200, body: "" };
      }

      const modal = buildRejectModal(data.replyId) as Record<string, unknown>;
      modal.private_metadata = JSON.stringify({
        replyId: data.replyId,
        commentId: data.commentId,
        messageTs: payload.message.ts,
        channelId,
      });
      await openModal(payload.trigger_id, modal, slackToken);
    }

    if (action.action_id === "confirm_delete") {
      const { comment, account } = await getAccountForComment(db, data.commentId);

      if (!comment || !account?.accessToken) {
        await updateMessage(
          channelId,
          payload.message.ts,
          [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `⚠️ *Delete failed* for comment ${data.commentId}`,
              },
            },
          ],
          "Comment delete failed",
          slackToken
        );
        return { statusCode: 200, body: "" };
      }

      try {
        await deleteComment(comment.platformCommentId, {
          accessToken: account.accessToken,
        });

        await db
          .update(comments)
          .set({
            deletedAt: new Date(),
            deletedBy: `slack:${reviewer.storageValue}`,
          })
          .where(eq(comments.id, data.commentId));

        await recordPipelineEvent(db, {
          commentId: data.commentId,
          stage: "delete_execute",
          status: "succeeded",
          reasonCode: "slack_confirmed_delete",
          payload: {
            reviewer: reviewer.storageValue,
            reviewerSlackUserId: payload.user.id,
          },
        });

        await updateMessage(
          channelId,
          payload.message.ts,
          [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `🗑️ *Deleted* by ${reviewer.display}`,
              },
            },
          ],
          "Comment deleted",
          slackToken
        );
      } catch (err) {
        await recordPipelineEvent(db, {
          commentId: data.commentId,
          stage: "delete_execute",
          status: "failed",
          reasonCode: "slack_delete_failed",
          reasonDetail: err instanceof Error ? err.message : String(err),
        });

        await updateMessage(
          channelId,
          payload.message.ts,
          [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `⚠️ *Delete failed* by ${reviewer.display}\n${err instanceof Error ? err.message : String(err)}`,
              },
            },
          ],
          "Comment delete failed",
          slackToken
        );
      }
    }

    if (action.action_id === "skip_delete") {
      await db
        .update(comments)
        .set({
          classificationGroup: "skip",
          skipReason: "delete_review_skipped_by_human",
        })
        .where(eq(comments.id, data.commentId));

      await recordPipelineEvent(db, {
        commentId: data.commentId,
        stage: "delete_review",
        status: "skipped",
        reasonCode: "delete_review_skipped_by_human",
        payload: {
          reviewer: reviewer.storageValue,
          reviewerSlackUserId: payload.user.id,
        },
      });

      await updateMessage(
        channelId,
        payload.message.ts,
        [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `⏭️ *Skipped* by ${reviewer.display} (comment stands)`,
            },
          },
        ],
        "Delete skipped",
        slackToken
      );
    }
  }

  if (payload.type === "view_submission" && payload.view) {
    const { callback_id, private_metadata, state } = payload.view;
    const metadata = JSON.parse(private_metadata) as {
      replyId: string;
      commentId?: string;
      messageTs?: string;
      channelId?: string;
    };

    if (callback_id === "edit_reply") {
      const replyId = metadata.replyId;
      const editedText = readSelectedValue(state.values, "reply_text_block", "reply_text") ?? "";
      const editCategory =
        readSelectedValue(state.values, "edit_category_block", "edit_category") ?? "voice_tweak";
      const editNotes = readSelectedValue(state.values, "edit_notes_block", "edit_notes");

      const reply = await getReplyById(db, replyId);

      if (!isPendingReply(reply)) {
        log("info", "Ignoring edit submission for non-pending reply", {
          replyId,
          status: reply?.approvalStatus ?? "missing",
        });
        return { statusCode: 200, body: "" };
      }

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
            {
              reviewReason: editCategory,
              reviewNotes: editNotes,
              originalReplyId: reply.id,
              policyVersion: CLASSIFIER_POLICY_VERSION,
            },
            { db, openaiApiKey: openaiKey }
          );
          await ingestResponseExample(
            comment.text,
            editedText,
            true,
            "slack_edited",
            comment.classificationGroup,
            {
              reviewReason: editCategory,
              reviewNotes: editNotes,
              originalReplyId: reply.id,
              policyVersion: CLASSIFIER_POLICY_VERSION,
            },
            { db, openaiApiKey: openaiKey }
          );

          await recordPipelineEvent(db, {
            commentId: comment.id,
            replyId: reply.id,
            stage: "slack_review",
            status: "succeeded",
            reasonCode: "slack_edited",
            payload: {
              reviewer: reviewer.storageValue,
              reviewerSlackUserId: payload.user.id,
              editCategory,
              editNotes,
            },
          });
        }
      }

      await db
        .update(replies)
        .set({
          editedText,
          approvalStatus: "approved",
          approvedBy: reviewer.storageValue,
          approvedAt: new Date(),
          reviewOutcomeReason: editCategory,
          reviewOutcomeCategory: getReviewOutcomeCategory(editCategory),
          reviewOutcomeNotes: editNotes ?? null,
        })
        .where(eq(replies.id, replyId));

      if (metadata.messageTs) {
        const handledContext = await getHandledReplyContext(db, replyId);
        await updateMessage(
          metadata.channelId ?? channelId,
          metadata.messageTs,
          buildHandledReplyMessage({
            outcome: "edited",
            reviewer: reviewer.display,
            reason: editCategory,
            notes: editNotes,
            ...(handledContext ?? {
              originalReply: editedText,
              finalReply: editedText,
              comment: {
                id: metadata.commentId ?? "",
                text: "Original comment unavailable",
                authorUsername: "unknown",
                likesCount: 0,
                postCaption: "",
              },
            }),
          }).blocks,
          "Reply edited and approved",
          slackToken
        );
      }

      log("info", "Reply edited and approved", {
        replyId,
        by: reviewer.storageValue,
        slackUserId: payload.user.id,
        editCategory,
      });
    }

    if (callback_id === "reject_reply") {
      const replyId = metadata.replyId;
      const rejectReason =
        readSelectedValue(state.values, "reject_reason_block", "reject_reason") ?? "other";
      const rejectNotes = readSelectedValue(state.values, "reject_notes_block", "reject_notes");

      const reply = await getReplyById(db, replyId);

      if (!isPendingReply(reply)) {
        log("info", "Ignoring reject submission for non-pending reply", {
          replyId,
          status: reply?.approvalStatus ?? "missing",
        });
        return { statusCode: 200, body: "" };
      }

      if (reply) {
        const { comment, account } = await getAccountForComment(db, reply.commentId);

        await db
          .update(replies)
          .set({
            approvalStatus: "rejected",
            reviewOutcomeReason: rejectReason,
            reviewOutcomeCategory: getReviewOutcomeCategory(rejectReason),
            reviewOutcomeNotes: rejectNotes ?? null,
          })
          .where(eq(replies.id, replyId));

        if (comment) {
          await ingestResponseExample(
            comment.text,
            reply.originalText,
            false,
            "slack_rejected",
            comment.classificationGroup,
            {
              reviewReason: rejectReason,
              reviewNotes: rejectNotes,
              originalReplyId: reply.id,
              policyVersion: CLASSIFIER_POLICY_VERSION,
            },
            { db, openaiApiKey: openaiKey }
          );

          await recordPipelineEvent(db, {
            commentId: comment.id,
            replyId: reply.id,
            stage: "slack_review",
            status: "failed",
            reasonCode: "slack_rejected",
            reasonDetail: rejectNotes ?? null,
            payload: {
              reviewer: reviewer.storageValue,
              reviewerSlackUserId: payload.user.id,
              rejectReason,
            },
          });
        }

        if (account?.id) {
          await decrementPending(account.id, db);
        }
      }

      if (metadata.messageTs) {
        const handledContext = await getHandledReplyContext(db, replyId);
        await updateMessage(
          metadata.channelId ?? channelId,
          metadata.messageTs,
          buildHandledReplyMessage({
            outcome: "rejected",
            reviewer: reviewer.display,
            reason: rejectReason,
            notes: rejectNotes,
            ...(handledContext ?? {
              originalReply: "Rejected draft unavailable",
              comment: {
                id: metadata.commentId ?? "",
                text: "Original comment unavailable",
                authorUsername: "unknown",
                likesCount: 0,
                postCaption: "",
              },
            }),
          }).blocks,
          "Reply rejected",
          slackToken
        );
      }

      log("info", "Reply rejected", {
        replyId,
        by: reviewer.storageValue,
        slackUserId: payload.user.id,
        rejectReason,
        hasRejectNotes: Boolean(rejectNotes),
        rejectNotesLength: rejectNotes?.length ?? 0,
      });
    }
  }

  return { statusCode: 200, body: "" };
});
