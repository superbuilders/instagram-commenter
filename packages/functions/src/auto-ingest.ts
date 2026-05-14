import { eq, and, gte, isNull, sql } from "drizzle-orm";
import {
  accounts,
  posts,
  comments,
  knowledgeSources,
} from "@instagram-commenter/core/db";
import {
  ingestContent,
  ingestBrainlift,
  createWorkflowyClient,
  syncBrainlifts,
} from "@instagram-commenter/core/knowledge";
import { getComments } from "@instagram-commenter/core/instagram";
import { createCronHandler, log } from "./lib/handler.js";
import { getOpenaiKey } from "./lib/secrets.js";

export const handler = createCronHandler("auto-ingest", async (db) => {
  const openaiKey = getOpenaiKey();
  const opts = { db, openaiApiKey: openaiKey };

  // 1. WorkFlowy BrainLift sync
  await syncWorkflowy(opts);

  // 2. Substack RSS
  await syncSubstack(opts);

  // 3. New IG captions
  await syncIgCaptions(opts);

  // 4. Manual replies from team (Jay/Juliana/MacKenzie replying on IG)
  await syncManualReplies(opts);

  // 5. Alpha School website
  await syncWebsite(opts);
});

async function syncWorkflowy(opts: { db: any; openaiApiKey: string }) {
  const token = process.env.WORKFLOWY_API_TOKEN;
  const rootId = process.env.WORKFLOWY_BRAINLIFT_ROOT_ID;

  if (!token || !rootId) {
    log("info", "Skipping WorkFlowy sync — not configured");
    return;
  }

  log("info", "Syncing WorkFlowy BrainLifts");
  const client = createWorkflowyClient(token);
  const report = await syncBrainlifts(client, rootId);

  for (const s of report.skipped) {
    log("warn", `BrainLift skipped: "${s.name}"`, { reason: s.reason });
  }

  let ingested = 0;
  for (const bl of report.synced) {
    const result = await ingestBrainlift(
      {
        sourceType: "brainlift",
        brainliftType: bl.mapping.brainliftType,
        title: bl.mapping.name,
        content: bl.content,
        sourceWeight: bl.mapping.sourceWeight,
        workflowyNodeId: bl.mapping.workflowyNodeId,
        contentHash: bl.contentHash,
      },
      opts
    );
    if (result.chunks > 0) ingested++;
  }

  log("info", "WorkFlowy sync complete", {
    synced: report.synced.length,
    ingested,
    skipped: report.skipped.length,
  });
}

async function syncSubstack(opts: { db: any; openaiApiKey: string }) {
  const rssUrl = process.env.SUBSTACK_RSS_URL;
  if (!rssUrl) {
    log("info", "Skipping Substack sync — SUBSTACK_RSS_URL not set");
    return;
  }

  log("info", "Checking Substack RSS");

  try {
    const response = await fetch(rssUrl);
    if (!response.ok) {
      log("error", "Substack RSS fetch failed", { status: response.status });
      return;
    }

    const xml = await response.text();

    // Simple XML parsing for RSS items
    const items: Array<{ title: string; link: string; content: string }> = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];
      const title =
        itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ??
        itemXml.match(/<title>(.*?)<\/title>/)?.[1] ??
        "";
      const link = itemXml.match(/<link>(.*?)<\/link>/)?.[1] ?? "";
      const content =
        itemXml.match(
          /<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/
        )?.[1] ?? "";

      if (title && content) {
        items.push({ title, link, content: stripHtml(content) });
      }
    }

    // Check which posts are already ingested
    const existingUrls = await opts.db
      .select({ url: knowledgeSources.sourceUrl })
      .from(knowledgeSources)
      .where(eq(knowledgeSources.sourceType, "substack"));

    const existingSet = new Set(existingUrls.map((r: any) => r.url));
    const newPosts = items.filter((item) => !existingSet.has(item.link));

    if (newPosts.length === 0) {
      log("info", "No new Substack posts");
      return;
    }

    log("info", `Ingesting ${newPosts.length} new Substack posts`);
    await ingestContent(
      newPosts.map((post) => ({
        sourceType: "substack" as const,
        title: post.title,
        content: post.content,
        sourceWeight: 1.0,
        sourceUrl: post.link,
      })),
      opts
    );
  } catch (err) {
    log("error", "Substack sync failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function syncIgCaptions(opts: { db: any; openaiApiKey: string }) {
  log("info", "Checking for new IG captions");

  // Find posts that have captions but haven't been ingested yet
  const uningested = await opts.db
    .select({
      id: posts.id,
      caption: posts.caption,
      permalink: posts.permalink,
      platformPostId: posts.platformPostId,
    })
    .from(posts)
    .leftJoin(
      knowledgeSources,
      and(
        eq(knowledgeSources.sourceType, "ig_caption"),
        sql`${knowledgeSources.metadata}->>'postId' = ${posts.platformPostId}`
      )
    )
    .where(and(sql`${posts.caption} IS NOT NULL`, isNull(knowledgeSources.id)))
    .limit(20);

  if (uningested.length === 0) {
    log("info", "No new IG captions to ingest");
    return;
  }

  log("info", `Ingesting ${uningested.length} new IG captions`);
  await ingestContent(
    uningested
      .filter((p: any) => p.caption && p.caption.length > 20)
      .map((p: any) => ({
        sourceType: "ig_caption" as const,
        title: p.caption.slice(0, 100),
        content: p.caption,
        sourceWeight: 1.0,
        sourceUrl: p.permalink,
        metadata: { postId: p.platformPostId },
      })),
    opts
  );
}

async function syncManualReplies(opts: { db: any; openaiApiKey: string }) {
  log("info", "Checking for manual team replies on IG");

  // Find comments where account owner replied (detected during ingest)
  // These are high-value voice training data
  const allAccounts = await opts.db.select().from(accounts);

  for (const account of allAccounts) {
    if (!account.accessToken) continue;

    // Find recent posts
    const recentPosts = await opts.db
      .select()
      .from(posts)
      .where(eq(posts.accountId, account.id))
      .limit(10);

    for (const post of recentPosts) {
      // Get comments from IG to find owner replies
      try {
        const igComments = await getComments(post.platformPostId, {
          accessToken: account.accessToken,
        });

        for (const comment of igComments) {
          if (!comment.replies?.data) continue;

          for (const reply of comment.replies.data) {
            // Check if this is from the account owner
            if (reply.username !== account.username) continue;

            // Check if we already have this as a training pair
            const existing = await opts.db
              .select({ id: knowledgeSources.id })
              .from(knowledgeSources)
              .where(
                and(
                  eq(knowledgeSources.sourceType, "ig_reply"),
                  sql`${knowledgeSources.metadata}->>'replyId' = ${reply.id}`
                )
              );

            if (existing.length > 0) continue;

            // Ingest as high-weight voice training
            await ingestContent(
              [
                {
                  sourceType: "ig_reply" as const,
                  title: `Reply to: ${comment.text.slice(0, 80)}`,
                  content: `Comment: ${comment.text}\n\nMacKenzie's reply: ${reply.text}`,
                  sourceWeight: 2.0,
                  metadata: {
                    replyId: reply.id,
                    commentId: comment.id,
                    postId: post.platformPostId,
                  },
                },
              ],
              opts
            );
          }
        }
      } catch {
        // Rate limit or API error — skip this post
      }
    }
  }

  log("info", "Manual reply sync complete");
}

async function syncWebsite(opts: { db: any; openaiApiKey: string }) {
  log("info", "Checking alpha.school for updates");

  // Only run weekly — check if we've scraped in the last 7 days
  const lastScrape = await opts.db
    .select({ updatedAt: knowledgeSources.updatedAt })
    .from(knowledgeSources)
    .where(eq(knowledgeSources.sourceType, "website"))
    .limit(1);

  if (lastScrape.length > 0) {
    const daysSince =
      (Date.now() - new Date(lastScrape[0].updatedAt).getTime()) /
      (1000 * 60 * 60 * 24);
    if (daysSince < 7) {
      log("info", "Website scraped within last 7 days, skipping");
      return;
    }
  }

  try {
    const response = await fetch("https://alpha.school");
    if (!response.ok) {
      log("error", "alpha.school fetch failed", { status: response.status });
      return;
    }

    const html = await response.text();
    const text = stripHtml(html);

    if (text.length < 100) {
      log("warn", "alpha.school returned very little content");
      return;
    }

    await ingestContent(
      [
        {
          sourceType: "website" as const,
          brainliftType: "institutional" as const,
          title: "Alpha School Website",
          content: text,
          sourceWeight: 1.0,
          sourceUrl: "https://alpha.school",
        },
      ],
      opts
    );

    log("info", "Website content ingested");
  } catch (err) {
    log("error", "Website sync failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
