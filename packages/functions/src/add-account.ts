import { desc, eq } from "drizzle-orm";
import { Resource } from "sst";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@instagram-commenter/core/db";
import { postMessage } from "@instagram-commenter/core/slack";
import { getLocalDateString } from "@instagram-commenter/core/time";
import {
  createDbBioLinkStore,
  fetchBioPage,
  refreshBioLinkInventory,
} from "@instagram-commenter/core/bio";

const SLACK_API_BASE = "https://slack.com/api";

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function formatGroup(group: string): string {
  return group.replace(/_/g, " ");
}

async function slackApi<T>(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`${SLACK_API_BASE}/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Slack HTTP ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deleteSlackMessage(
  token: string,
  channelId: string,
  messageTs: string
): Promise<{ ok: boolean; error?: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`${SLACK_API_BASE}/chat.delete`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: channelId, ts: messageTs }),
    });

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "2");
      await sleep(Math.max(1, retryAfter) * 1000);
      continue;
    }

    if (!response.ok) {
      return { ok: false, error: `http_${response.status}` };
    }

    return response.json() as Promise<{ ok: boolean; error?: string }>;
  }

  return { ok: false, error: "rate_limited" };
}

export async function handler(event: { body?: string } = {}) {
  const host = process.env.DATABASE_HOST;
  const port = process.env.DATABASE_PORT ?? "5432";
  const dbName = process.env.DATABASE_NAME ?? "instagram_commenter";
  const user = process.env.DATABASE_USERNAME ?? "app";
  const password = (Resource as any).DatabasePassword.value;
  const url = `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/${dbName}`;
  const pool = new pg.Pool({ connectionString: url, max: 1, ssl: { rejectUnauthorized: false } });
  const db = drizzle(pool, { schema });

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    if (body.action === "refresh_bio_inventory") {
      if (body.exportKey !== password) {
        await pool.end();
        return { statusCode: 403, body: JSON.stringify({ success: false, error: "Forbidden" }) };
      }

      const bioUrl =
        typeof body.bioUrl === "string" && body.bioUrl.trim()
          ? body.bioUrl.trim()
          : null;
      if (!bioUrl) {
        await pool.end();
        return {
          statusCode: 400,
          body: JSON.stringify({ success: false, error: "bioUrl is required" }),
        };
      }

      const accountRows = await db
        .select()
        .from(schema.accounts)
        .where(
          body.accountId
            ? eq(schema.accounts.id, body.accountId)
            : body.profileUsername
              ? eq(schema.accounts.username, body.profileUsername)
              : eq(schema.accounts.username, "futureof_education")
        )
        .limit(1);

      const account = accountRows[0];
      if (!account) {
        await pool.end();
        return {
          statusCode: 404,
          body: JSON.stringify({ success: false, error: "account not found" }),
        };
      }

      const snapshotFreshForDays = Number.isFinite(Number(body.snapshotFreshForDays))
        ? Math.max(Number(body.snapshotFreshForDays), 0)
        : 30;

      const report = await refreshBioLinkInventory(
        {
          accountId: account.id,
          profileUsername: account.username,
          bioUrl,
        },
        {
          store: createDbBioLinkStore(db),
          fetchPage: fetchBioPage,
          snapshotFreshForMs: snapshotFreshForDays * 24 * 60 * 60 * 1000,
        }
      );

      await pool.end();
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, report }),
      };
    }

    if (body.action === "retire_slack_reviews") {
      if (body.exportKey !== password) {
        await pool.end();
        return { statusCode: 403, body: JSON.stringify({ success: false, error: "Forbidden" }) };
      }

      const apply = body.apply === true;
      const deleteSlackMessages = body.deleteSlackMessages === true;
      const includeRetired = body.includeRetired === true;
      const limit = Number.isFinite(Number(body.limit))
        ? Math.min(Math.max(Number(body.limit), 1), 500)
        : 100;
      const olderThanHours = Number.isFinite(Number(body.olderThanHours))
        ? Math.max(Number(body.olderThanHours), 0)
        : null;
      const beforeCreatedAt =
        typeof body.beforeCreatedAt === "string" && body.beforeCreatedAt.trim()
          ? new Date(body.beforeCreatedAt)
          : null;

      if (beforeCreatedAt && Number.isNaN(beforeCreatedAt.getTime())) {
        await pool.end();
        return {
          statusCode: 400,
          body: JSON.stringify({ success: false, error: "Invalid beforeCreatedAt" }),
        };
      }

      const cutoff = beforeCreatedAt
        ? beforeCreatedAt
        : new Date(Date.now() - (olderThanHours ?? 24) * 60 * 60 * 1000);

      const total = await pool.query<{ count: string }>(
        `
        SELECT COUNT(*) AS count
        FROM replies
        WHERE (
            approval_status = 'pending'
            OR (
              $2::boolean = true
              AND review_outcome_notes = 'stale_review_reset: retired by retire_slack_reviews maintenance action.'
            )
          )
          AND slack_message_ts IS NOT NULL
          AND created_at < $1
        `,
        [cutoff, includeRetired]
      );

      const matches = await pool.query<{
        reply_id: string;
        comment_id: string;
        slack_message_ts: string;
        reply_created_at: string;
        comment_text: string;
        author_username: string | null;
        classification_group: string | null;
      }>(
        `
        SELECT
          r.id AS reply_id,
          r.comment_id,
          r.slack_message_ts,
          r.created_at AS reply_created_at,
          c.text AS comment_text,
          c.author_username,
          c.classification_group
        FROM replies r
        INNER JOIN comments c ON c.id = r.comment_id
        WHERE (
            r.approval_status = 'pending'
            OR (
              $3::boolean = true
              AND r.review_outcome_notes = 'stale_review_reset: retired by retire_slack_reviews maintenance action.'
            )
          )
          AND r.slack_message_ts IS NOT NULL
          AND r.created_at < $1
        ORDER BY r.created_at ASC
        LIMIT $2
        `,
        [cutoff, limit, includeRetired]
      );

      const deletedSlackMessages: Array<{ replyId: string; ts: string }> = [];
      const deleteFailures: Array<{ replyId: string; ts: string; error: string }> = [];

      if (apply && matches.rows.length > 0) {
        await pool.query(
          `
          UPDATE replies
          SET
            approval_status = 'rejected',
            review_outcome_reason = 'other',
            review_outcome_category = 'operator',
            review_outcome_notes = 'stale_review_reset: retired by retire_slack_reviews maintenance action.'
          WHERE id = ANY($1::uuid[])
          `,
          [matches.rows.map((row) => row.reply_id)]
        );

        if (deleteSlackMessages) {
          const slackToken = (Resource as any).SlackBotToken.value;
          const channelId = (Resource as any).SlackChannelId.value;
          for (const row of matches.rows) {
            const result = await deleteSlackMessage(
              slackToken,
              channelId,
              row.slack_message_ts
            );
            if (result.ok || result.error === "message_not_found") {
              deletedSlackMessages.push({
                replyId: row.reply_id,
                ts: row.slack_message_ts,
              });
            } else {
              deleteFailures.push({
                replyId: row.reply_id,
                ts: row.slack_message_ts,
                error: result.error ?? "unknown_error",
              });
            }
          }

          if (deletedSlackMessages.length > 0) {
            await pool.query(
              `
              UPDATE replies
              SET slack_message_ts = NULL
              WHERE id = ANY($1::uuid[])
              `,
              [deletedSlackMessages.map((row) => row.replyId)]
            );
          }
        }
      }

      await pool.end();
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          apply,
          deleteSlackMessages,
          cutoff: cutoff.toISOString(),
          totalMatching: Number(total.rows[0]?.count ?? 0),
          selected: matches.rows.length,
          retired: apply ? matches.rows.length : 0,
          deletedSlackMessages: deletedSlackMessages.length,
          deleteFailures,
          sample: matches.rows.slice(0, 10).map((row) => ({
            replyId: row.reply_id,
            createdAt: row.reply_created_at,
            classificationGroup: row.classification_group,
            authorUsername: row.author_username,
            text: truncate(row.comment_text, 160),
            slackMessageTs: row.slack_message_ts,
          })),
        }),
      };
    }

    if (body.action === "missed_comments_report") {
      if (body.exportKey !== password) {
        await pool.end();
        return { statusCode: 403, body: JSON.stringify({ success: false, error: "Forbidden" }) };
      }

      const lookbackDays = Number.isFinite(Number(body.lookbackDays))
        ? Math.min(Math.max(Number(body.lookbackDays), 1), 14)
        : 7;
      const limit = Number.isFinite(Number(body.limit))
        ? Math.min(Math.max(Number(body.limit), 1), 15)
        : 15;

      const { rows } = await pool.query<{
        id: string;
        text: string;
        author_username: string | null;
        likes_count: number;
        classification_group: string;
        narrative_topic: string | null;
        info_type: string | null;
        skip_reason: string | null;
        permalink: string | null;
        no_knowledge_events: string;
      }>(
        `
        SELECT
          c.id,
          c.text,
          c.author_username,
          c.likes_count,
          c.classification_group,
          c.narrative_topic,
          c.info_type,
          c.skip_reason,
          p.permalink,
          (
            SELECT COUNT(*)
            FROM comment_pipeline_events e
            WHERE e.comment_id = c.id
              AND e.reason_code = 'no_relevant_knowledge'
          ) AS no_knowledge_events
        FROM comments c
        INNER JOIN posts p ON p.id = c.post_id
        LEFT JOIN replies r ON r.comment_id = c.id
        WHERE c.created_at >= NOW() - ($1::int * INTERVAL '1 day')
          AND c.classification_group IN ('narrative_shaping', 'community_building', 'informational')
          AND r.id IS NULL
        ORDER BY
          CASE WHEN c.classification_group = 'narrative_shaping' THEN 0
               WHEN c.classification_group = 'community_building' THEN 1
               ELSE 2
          END,
          c.likes_count DESC,
          c.created_at DESC
        LIMIT $2
        `,
        [lookbackDays, limit]
      );

      const counts = await pool.query<{
        classification_group: string;
        count: string;
      }>(
        `
        SELECT c.classification_group, COUNT(*) AS count
        FROM comments c
        LEFT JOIN replies r ON r.comment_id = c.id
        WHERE c.created_at >= NOW() - ($1::int * INTERVAL '1 day')
          AND c.classification_group IN ('narrative_shaping', 'community_building', 'informational')
          AND r.id IS NULL
        GROUP BY c.classification_group
        ORDER BY count DESC
        `,
        [lookbackDays]
      );

      const summary = counts.rows
        .map((row) => `${formatGroup(row.classification_group)}: ${row.count}`)
        .join(" | ");

      const blocks: any[] = [
        {
          type: "header",
          text: { type: "plain_text", text: `Missed IG comments: last ${lookbackDays} days` },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: summary
              ? `Unhandled actionable comments by type: ${summary}`
              : "No unhandled actionable comments found.",
          },
        },
      ];

      for (const row of rows) {
        const topic = row.narrative_topic ?? row.info_type ?? "general";
        const retryNote =
          Number(row.no_knowledge_events) > 0
            ? ` | no knowledge hits: ${row.no_knowledge_events}`
            : "";
        const link = row.permalink ? ` | <${row.permalink}|post>` : "";
        blocks.push(
          { type: "divider" },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                `*${formatGroup(row.classification_group)}* / ${topic} / ${row.likes_count} likes${retryNote}${link}\n` +
                `*@${row.author_username ?? "unknown"}:* ${truncate(row.text, 450)}`,
            },
          }
        );
      }

      const slackToken = (Resource as any).SlackBotToken.value;
      const channelId = (Resource as any).SlackChannelId.value;
      await postMessage(
        channelId,
        blocks,
        `Missed IG comments report: ${rows.length} comments from the last ${lookbackDays} days`,
        slackToken
      );

      await pool.end();
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, count: rows.length, summary: counts.rows }),
      };
    }

    if (body.action === "feedback_inspect") {
      if (body.exportKey !== password) {
        await pool.end();
        return { statusCode: 403, body: JSON.stringify({ success: false, error: "Forbidden" }) };
      }

      const limit = Number.isFinite(Number(body.limit))
        ? Math.min(Math.max(Number(body.limit), 1), 25)
        : 10;

      const reviewedReplies = await db
        .select({
          replyId: schema.replies.id,
          approvalStatus: schema.replies.approvalStatus,
          reviewOutcomeReason: schema.replies.reviewOutcomeReason,
          reviewOutcomeCategory: schema.replies.reviewOutcomeCategory,
          reviewOutcomeNotes: schema.replies.reviewOutcomeNotes,
          originalText: schema.replies.originalText,
          editedText: schema.replies.editedText,
          approvedBy: schema.replies.approvedBy,
          approvedAt: schema.replies.approvedAt,
          replyCreatedAt: schema.replies.createdAt,
          commentId: schema.comments.id,
          commentText: schema.comments.text,
          authorUsername: schema.comments.authorUsername,
          classificationGroup: schema.comments.classificationGroup,
          classificationConfidence: schema.comments.classificationConfidence,
          narrativeTopic: schema.comments.narrativeTopic,
          infoType: schema.comments.infoType,
          skipReason: schema.comments.skipReason,
          deleteReason: schema.comments.deleteReason,
          classificationRationaleTags: schema.comments.classificationRationaleTags,
          commentedAt: schema.comments.commentedAt,
          postPermalink: schema.posts.permalink,
        })
        .from(schema.replies)
        .innerJoin(schema.comments, eq(schema.replies.commentId, schema.comments.id))
        .innerJoin(schema.posts, eq(schema.comments.postId, schema.posts.id))
        .where(eq(schema.replies.approvalStatus, body.status ?? "rejected"))
        .orderBy(desc(schema.replies.createdAt))
        .limit(limit);

      const feedback = await Promise.all(
        reviewedReplies.map(async (reply) => {
          const examples = await db
            .select({
              id: schema.responseExamples.id,
              source: schema.responseExamples.source,
              isPositive: schema.responseExamples.isPositive,
              reviewReason: schema.responseExamples.reviewReason,
              reviewNotes: schema.responseExamples.reviewNotes,
              policyVersion: schema.responseExamples.policyVersion,
              createdAt: schema.responseExamples.createdAt,
            })
            .from(schema.responseExamples)
            .where(eq(schema.responseExamples.originalReplyId, reply.replyId))
            .orderBy(desc(schema.responseExamples.createdAt))
            .limit(5);

          const events = await db
            .select({
              id: schema.commentPipelineEvents.id,
              stage: schema.commentPipelineEvents.stage,
              status: schema.commentPipelineEvents.status,
              reasonCode: schema.commentPipelineEvents.reasonCode,
              reasonDetail: schema.commentPipelineEvents.reasonDetail,
              payload: schema.commentPipelineEvents.payload,
              createdAt: schema.commentPipelineEvents.createdAt,
            })
            .from(schema.commentPipelineEvents)
            .where(eq(schema.commentPipelineEvents.replyId, reply.replyId))
            .orderBy(desc(schema.commentPipelineEvents.createdAt))
            .limit(10);

          return { ...reply, examples, events };
        })
      );

      await pool.end();
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, count: feedback.length, feedback }),
      };
    }

    if (body.action === "pipeline_issue_inspect") {
      if (body.exportKey !== password) {
        await pool.end();
        return { statusCode: 403, body: JSON.stringify({ success: false, error: "Forbidden" }) };
      }

      const lookbackDays = Number.isFinite(Number(body.lookbackDays))
        ? Math.min(Math.max(Number(body.lookbackDays), 1), 30)
        : 7;
      const sampleLimit = Number.isFinite(Number(body.limit))
        ? Math.min(Math.max(Number(body.limit), 1), 50)
        : 15;
      const topic = typeof body.topic === "string" && body.topic.trim()
        ? body.topic.trim()
        : null;
      const reasonCode = typeof body.reasonCode === "string" && body.reasonCode.trim()
        ? body.reasonCode.trim()
        : null;

      const issueCounts = await pool.query(
        `
        SELECT
          e.stage,
          e.status,
          COALESCE(e.reason_code, e.status::text) AS reason_code,
          COUNT(*)::int AS event_count,
          COUNT(DISTINCT e.comment_id)::int AS comment_count
        FROM comment_pipeline_events e
        WHERE e.created_at >= NOW() - ($1::int * INTERVAL '1 day')
          AND e.status IN ('failed', 'skipped')
        GROUP BY e.stage, e.status, COALESCE(e.reason_code, e.status::text)
        ORDER BY event_count DESC
        `,
        [lookbackDays]
      );

      const gapCounts = await pool.query(
        `
        SELECT
          COALESCE(
            e.payload->>'narrativeTopic',
            e.payload->>'infoType',
            e.payload->>'classificationGroup',
            'general'
          ) AS topic,
          COUNT(*)::int AS event_count,
          COUNT(DISTINCT e.comment_id)::int AS comment_count
        FROM comment_pipeline_events e
        WHERE e.created_at >= NOW() - ($1::int * INTERVAL '1 day')
          AND e.reason_code = 'no_relevant_knowledge'
        GROUP BY COALESCE(
          e.payload->>'narrativeTopic',
          e.payload->>'infoType',
          e.payload->>'classificationGroup',
          'general'
        )
        ORDER BY event_count DESC
        `,
        [lookbackDays]
      );

      const sampleParams: Array<string | number | null> = [lookbackDays, sampleLimit, topic, reasonCode];
      const samples = await pool.query(
        `
        WITH latest_matching_event AS (
          SELECT DISTINCT ON (e.comment_id)
            e.comment_id,
            e.stage,
            e.status,
            e.reason_code,
            e.reason_detail,
            e.payload,
            e.created_at AS event_created_at
          FROM comment_pipeline_events e
          WHERE e.created_at >= NOW() - ($1::int * INTERVAL '1 day')
            AND e.status IN ('failed', 'skipped')
            AND ($3::text IS NULL OR COALESCE(
              e.payload->>'narrativeTopic',
              e.payload->>'infoType',
              e.payload->>'classificationGroup',
              'general'
            ) = $3::text)
            AND ($4::text IS NULL OR e.reason_code = $4::text)
          ORDER BY e.comment_id, e.created_at DESC
        ),
        event_counts AS (
          SELECT
            comment_id,
            COUNT(*)::int AS matching_event_count
          FROM comment_pipeline_events
          WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
            AND status IN ('failed', 'skipped')
            AND ($4::text IS NULL OR reason_code = $4::text)
          GROUP BY comment_id
        )
        SELECT
          c.id,
          c.text,
          c.author_username,
          c.likes_count,
          c.classification_group,
          c.classification_confidence,
          c.narrative_topic,
          c.info_type,
          c.skip_reason,
          c.delete_reason,
          c.created_at AS comment_created_at,
          c.commented_at,
          p.caption AS post_caption,
          p.permalink,
          l.stage,
          l.status,
          l.reason_code,
          l.reason_detail,
          l.payload,
          l.event_created_at,
          ec.matching_event_count
        FROM latest_matching_event l
        INNER JOIN comments c ON c.id = l.comment_id
        INNER JOIN posts p ON p.id = c.post_id
        LEFT JOIN event_counts ec ON ec.comment_id = c.id
        ORDER BY
          CASE WHEN c.classification_group = 'narrative_shaping' THEN 0
               WHEN c.classification_group = 'community_building' THEN 1
               WHEN c.classification_group = 'informational' THEN 2
               ELSE 3
          END,
          c.likes_count DESC,
          l.event_created_at DESC
        LIMIT $2
        `,
        sampleParams
      );

      const knowledgeCoverage = await pool.query(
        `
        SELECT
          source_type,
          COALESCE(brainlift_type::text, 'none') AS brainlift_type,
          COALESCE(NULLIF(array_to_string(narrative_topics, ','), ''), 'untagged') AS narrative_topics,
          COUNT(*)::int AS count
        FROM knowledge_sources
        GROUP BY source_type, brainlift_type, COALESCE(NULLIF(array_to_string(narrative_topics, ','), ''), 'untagged')
        ORDER BY count DESC
        LIMIT 50
        `
      );

      await pool.end();
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          lookbackDays,
          filters: { topic, reasonCode },
          issueCounts: issueCounts.rows,
          gapCounts: gapCounts.rows,
          samples: samples.rows,
          knowledgeCoverage: knowledgeCoverage.rows,
        }),
      };
    }

    if (body.action === "pipeline_status") {
      if (body.exportKey !== password) {
        await pool.end();
        return { statusCode: 403, body: JSON.stringify({ success: false, error: "Forbidden" }) };
      }

      const lookbackHours = Number.isFinite(Number(body.lookbackHours))
        ? Math.min(Math.max(Number(body.lookbackHours), 1), 168)
        : 24;

      const summary = await pool.query(
        `
        SELECT
          COUNT(*) FILTER (WHERE c.created_at >= NOW() - ($1::int * INTERVAL '1 hour'))::int AS comments_ingested,
          COUNT(*) FILTER (WHERE c.created_at >= NOW() - ($1::int * INTERVAL '1 hour') AND c.classification_group IS NULL)::int AS unclassified,
          COUNT(*) FILTER (WHERE c.created_at >= NOW() - ($1::int * INTERVAL '1 hour') AND c.classification_group IN ('narrative_shaping', 'community_building', 'informational'))::int AS actionable,
          COUNT(*) FILTER (WHERE c.created_at >= NOW() - ($1::int * INTERVAL '1 hour') AND c.classification_group = 'skip')::int AS skipped,
          COUNT(*) FILTER (WHERE c.created_at >= NOW() - ($1::int * INTERVAL '1 hour') AND c.classification_group = 'delete')::int AS delete_candidates
        FROM comments c
        `,
        [lookbackHours]
      );

      const eventSummary = await pool.query(
        `
        SELECT
          stage,
          status,
          COALESCE(reason_code, status::text) AS reason_code,
          COUNT(*)::int AS event_count,
          COUNT(DISTINCT comment_id)::int AS comment_count
        FROM comment_pipeline_events
        WHERE created_at >= NOW() - ($1::int * INTERVAL '1 hour')
        GROUP BY stage, status, COALESCE(reason_code, status::text)
        ORDER BY stage, status, event_count DESC
        `,
        [lookbackHours]
      );

      const replySummary = await pool.query(
        `
        SELECT
          approval_status,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE created_at >= NOW() - ($1::int * INTERVAL '1 hour'))::int AS created_recently,
          COUNT(*) FILTER (WHERE slack_message_ts IS NOT NULL AND created_at >= NOW() - ($1::int * INTERVAL '1 hour'))::int AS sent_to_slack_recently
        FROM replies
        GROUP BY approval_status
        ORDER BY approval_status
        `,
        [lookbackHours]
      );

      const budgets = await pool.query(
        `
        SELECT
          budget_date,
          budget_limit,
          replies_allocated,
          replies_pending,
          replies_posted,
          narrative_replies,
          community_replies,
          informational_replies
        FROM daily_budgets
        ORDER BY budget_date DESC
        LIMIT 3
        `
      );

      const latestSlack = await pool.query(
        `
        SELECT
          r.id AS reply_id,
          r.approval_status,
          r.created_at,
          r.slack_message_ts,
          c.classification_group,
          c.narrative_topic,
          c.info_type,
          c.likes_count,
          c.author_username,
          c.text
        FROM replies r
        INNER JOIN comments c ON c.id = r.comment_id
        WHERE r.slack_message_ts IS NOT NULL
        ORDER BY r.created_at DESC
        LIMIT 15
        `
      );

      const eligibleNow = await pool.query(
        `
        SELECT
          c.classification_group,
          c.narrative_topic,
          c.info_type,
          COUNT(*)::int AS count
        FROM comments c
        INNER JOIN posts p ON p.id = c.post_id
        LEFT JOIN replies r ON r.comment_id = c.id
        WHERE c.classification_group IN ('narrative_shaping', 'community_building', 'informational')
          AND r.id IS NULL
          AND c.skip_reason IS NULL
        GROUP BY c.classification_group, c.narrative_topic, c.info_type
        ORDER BY count DESC
        LIMIT 25
        `
      );

      await pool.end();
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          lookbackHours,
          summary: summary.rows[0],
          eventSummary: eventSummary.rows,
          replySummary: replySummary.rows,
          budgets: budgets.rows,
          latestSlack: latestSlack.rows,
          eligibleNow: eligibleNow.rows,
        }),
      };
    }

    if (body.action === "reset_daily_budget") {
      if (body.exportKey !== password) {
        await pool.end();
        return { statusCode: 403, body: JSON.stringify({ success: false, error: "Forbidden" }) };
      }

      const budgetDate = typeof body.budgetDate === "string" && body.budgetDate.trim()
        ? body.budgetDate.trim()
        : getLocalDateString();

      const reset = await pool.query(
        `
        UPDATE daily_budgets
        SET
          replies_allocated = 0,
          replies_pending = 0,
          replies_posted = 0,
          narrative_replies = 0,
          community_replies = 0,
          informational_replies = 0,
          updated_at = NOW()
        WHERE budget_date = $1::date
        RETURNING
          account_id,
          budget_date,
          budget_limit,
          replies_allocated,
          replies_pending,
          replies_posted
        `,
        [budgetDate]
      );

      await pool.end();
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          budgetDate,
          reset: reset.rows,
        }),
      };
    }

    // Support deactivating an account by platformId (nulls the token)
    if (body.action === "deactivate" && body.platformId) {
      const updated = await db
        .update(schema.accounts)
        .set({ accessToken: null, updatedAt: new Date() })
        .where(eq(schema.accounts.platformId, body.platformId))
        .returning();
      await pool.end();
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, deactivated: updated.length }),
      };
    }

    const [account] = await db
      .insert(schema.accounts)
      .values({
        platform: "instagram",
        platformId: body.platformId ?? "17841461806812229",
        username: body.username ?? "futureof_education",
        displayName: body.displayName ?? "MacKenzie Price | Founder of 2HourLearning",
        accessToken: body.accessToken,
        tokenExpiresAt: body.tokenExpiresAt ? new Date(body.tokenExpiresAt) : null,
      })
      .onConflictDoUpdate({
        target: schema.accounts.platformId,
        set: {
          accessToken: body.accessToken,
          tokenExpiresAt: body.tokenExpiresAt ? new Date(body.tokenExpiresAt) : null,
          updatedAt: new Date(),
        },
      })
      .returning();

    await pool.end();
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, account: account ?? "already exists" }),
    };
  } catch (err: any) {
    await pool.end();
    return { statusCode: 500, body: err.message };
  }
}
