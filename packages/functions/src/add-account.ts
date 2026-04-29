import { desc, eq } from "drizzle-orm";
import { Resource } from "sst";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@instagram-commenter/core/db";
import { postMessage } from "@instagram-commenter/core/slack";

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function formatGroup(group: string): string {
  return group.replace(/_/g, " ");
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
