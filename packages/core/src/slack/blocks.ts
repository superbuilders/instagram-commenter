import {
  EDIT_CATEGORIES,
  REJECT_REASONS,
} from "../pipeline/index.js";

function formatOptionLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

interface CommentContext {
  id: string;
  text: string;
  authorUsername: string;
  likesCount: number;
  postCaption: string;
  postPermalink?: string;
}

interface ReplyContext {
  id: string;
  text: string;
  classificationGroup: string;
  confidence: number;
  narrativeTopic?: string;
}

export function buildApprovalMessage(
  comment: CommentContext,
  reply: ReplyContext,
  postCaption: string
) {
  const classLabel = reply.classificationGroup.replace(/_/g, " ");
  const confidencePct = Math.round(reply.confidence * 100);

  return {
    text: `New reply for review: "${reply.text.slice(0, 50)}..."`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${classLabel} reply (${confidencePct}% confidence)`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Comment by @${comment.authorUsername}* (${comment.likesCount} likes):\n>${comment.text.slice(0, 500)}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Post caption:*\n${postCaption.slice(0, 200)}`,
        },
      },
      ...(comment.postPermalink
        ? [
            {
              type: "context",
              elements: [
                { type: "mrkdwn", text: `<${comment.postPermalink}|View post on Instagram>` },
              ],
            },
          ]
        : []),
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Proposed reply:*\n${reply.text}`,
        },
      },
      ...(reply.narrativeTopic
        ? [
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `Narrative topic: *${reply.narrativeTopic}*`,
                },
              ],
            },
          ]
        : []),
      {
        type: "actions",
        block_id: "approval_actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Approve" },
            style: "primary",
            action_id: "approve",
            value: JSON.stringify({
              replyId: reply.id,
              commentId: comment.id,
            }),
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Edit" },
            action_id: "edit",
            value: JSON.stringify({
              replyId: reply.id,
              commentId: comment.id,
              originalText: reply.text,
            }),
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Reject" },
            style: "danger",
            action_id: "reject",
            value: JSON.stringify({
              replyId: reply.id,
              commentId: comment.id,
            }),
          },
        ],
      },
    ],
  };
}

export function buildEditModal(replyId: string, originalText: string) {
  return {
    type: "modal" as const,
    callback_id: "edit_reply",
    title: { type: "plain_text" as const, text: "Edit Reply" },
    submit: { type: "plain_text" as const, text: "Submit" },
    close: { type: "plain_text" as const, text: "Cancel" },
    private_metadata: JSON.stringify({ replyId }),
    blocks: [
      {
        type: "input",
        block_id: "edit_category_block",
        element: {
          type: "static_select",
          action_id: "edit_category",
          initial_option: {
            text: { type: "plain_text", text: formatOptionLabel("voice_tweak") },
            value: "voice_tweak",
          },
          options: EDIT_CATEGORIES.map((value) => ({
            text: {
              type: "plain_text",
              text: formatOptionLabel(value),
            },
            value,
          })),
        },
        label: { type: "plain_text", text: "What kind of edit is this?" },
      },
      {
        type: "input",
        block_id: "reply_text_block",
        element: {
          type: "plain_text_input",
          action_id: "reply_text",
          multiline: true,
          initial_value: originalText,
          max_length: 500,
        },
        label: { type: "plain_text", text: "Reply text" },
        hint: {
          type: "plain_text",
          text: "Edit the reply. This will be posted as MacKenzie.",
        },
      },
      {
        type: "input",
        optional: true,
        block_id: "edit_notes_block",
        element: {
          type: "plain_text_input",
          action_id: "edit_notes",
          multiline: true,
        },
        label: { type: "plain_text", text: "Notes (optional)" },
      },
    ],
  };
}

export function buildRejectModal(replyId: string) {
  return {
    type: "modal" as const,
    callback_id: "reject_reply",
    title: { type: "plain_text" as const, text: "Reject Reply" },
    submit: { type: "plain_text" as const, text: "Save" },
    close: { type: "plain_text" as const, text: "Cancel" },
    private_metadata: JSON.stringify({ replyId }),
    blocks: [
      {
        type: "input",
        block_id: "reject_reason_block",
        element: {
          type: "static_select",
          action_id: "reject_reason",
          options: REJECT_REASONS.map((value) => ({
            text: {
              type: "plain_text",
              text: formatOptionLabel(value),
            },
            value,
          })),
        },
        label: { type: "plain_text", text: "Why is this reply being rejected?" },
      },
      {
        type: "input",
        optional: true,
        block_id: "reject_notes_block",
        element: {
          type: "plain_text_input",
          action_id: "reject_notes",
          multiline: true,
        },
        label: { type: "plain_text", text: "Notes (optional)" },
      },
    ],
  };
}

export function buildDeleteApprovalMessage(
  comment: CommentContext,
  deleteReason: string,
  confidence: number
) {
  const confidencePct = Math.round(confidence * 100);

  return {
    text: `Delete review: "${comment.text.slice(0, 50)}..."`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `Delete candidate (${confidencePct}% confidence)`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Comment by @${comment.authorUsername}* (${comment.likesCount} likes):\n>${comment.text.slice(0, 500)}`,
        },
      },
      ...(comment.postCaption
        ? [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Post caption:*\n${comment.postCaption.slice(0, 200)}`,
              },
            },
          ]
        : []),
      ...(comment.postPermalink
        ? [
            {
              type: "context",
              elements: [
                { type: "mrkdwn", text: `<${comment.postPermalink}|View post on Instagram>` },
              ],
            },
          ]
        : []),
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Reason:* ${deleteReason}`,
        },
      },
      {
        type: "actions",
        block_id: "delete_actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Delete" },
            style: "danger",
            action_id: "confirm_delete",
            value: JSON.stringify({ commentId: comment.id }),
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Skip (let it stand)" },
            action_id: "skip_delete",
            value: JSON.stringify({ commentId: comment.id }),
          },
        ],
      },
    ],
  };
}

export function buildDigestMessage(stats: {
  date: string;
  totalComments: number;
  classifications: Record<string, number>;
  repliesPosted: number;
  repliesApproved: number;
  repliesEdited: number;
  repliesRejected: number;
  repliesAuto: number;
  deletionsExecuted: number;
  budgetUtilization: number;
  gapTopics: Array<{ topic: string; commentCount: number; eventCount: number }>;
  topRejectReasons?: Array<{ reason: string; count: number }>;
  pipelineIssues?: Array<{ label: string; commentCount: number; eventCount: number }>;
  evalScore?: { accuracy: number; date: string } | null;
}) {
  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `Daily Digest — ${stats.date}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*Comments seen:* ${stats.totalComments}`,
          `*Replies posted:* ${stats.repliesPosted} (budget: ${Math.round(stats.budgetUtilization * 100)}%)`,
          `*Deletions:* ${stats.deletionsExecuted}`,
        ].join("\n"),
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          "*Classification breakdown:*",
          ...Object.entries(stats.classifications).map(
            ([k, v]) => `  ${k.replace(/_/g, " ")}: ${v}`
          ),
        ].join("\n"),
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          "*Approval stats:*",
          `  Approved: ${stats.repliesApproved}`,
          `  Edited: ${stats.repliesEdited}`,
          `  Rejected: ${stats.repliesRejected}`,
          `  Auto: ${stats.repliesAuto}`,
        ].join("\n"),
      },
    },
  ];

  if (stats.evalScore) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📊 *AI Quality:* Classifier accuracy ${stats.evalScore.accuracy}% (last eval: ${stats.evalScore.date})`,
      },
    });
  }

  if (stats.gapTopics.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          "*Knowledge gaps (topics the bot couldn't answer):*",
          ...stats.gapTopics.map(
            (t) => `  ${t.topic}: ${t.commentCount} unique comments (${t.eventCount} events)`
          ),
        ].join("\n"),
      },
    });
  }

  if ((stats.pipelineIssues?.length ?? 0) > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          "*Pipeline issues:*",
          ...stats.pipelineIssues!.map(
            (item) => `  ${item.label}: ${item.commentCount} unique comments (${item.eventCount} events)`
          ),
        ].join("\n"),
      },
    });
  }

  if ((stats.topRejectReasons?.length ?? 0) > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          "*Top rejection reasons:*",
          ...stats.topRejectReasons!.map((item) => `  ${item.reason.replace(/_/g, " ")}: ${item.count}`),
        ].join("\n"),
      },
    });
  }

  return { text: `Daily Digest — ${stats.date}`, blocks };
}
