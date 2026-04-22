import { eq, sql } from "drizzle-orm";
import { Resource } from "sst";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@instagram-commenter/core/db";
import {
  ingestContent,
  ingestResponseExample,
  type ContentSource,
} from "@instagram-commenter/core/knowledge";

function getDb() {
  const host = process.env.DATABASE_HOST;
  const port = process.env.DATABASE_PORT ?? "5432";
  const dbName = process.env.DATABASE_NAME ?? "instagram_commenter";
  const user = process.env.DATABASE_USERNAME ?? "app";
  const password = (Resource as any).DatabasePassword.value;
  const url = `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/${dbName}`;
  const pool = new pg.Pool({ connectionString: url, max: 1, ssl: { rejectUnauthorized: false } });
  return drizzle(pool, { schema });
}

function getOpenaiKey(): string {
  return (Resource as any).OpenaiApiKey.value;
}

async function isSourceUrlIngested(db: any, sourceUrl: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.knowledgeSources.id })
    .from(schema.knowledgeSources)
    .where(eq(schema.knowledgeSources.sourceUrl, sourceUrl))
    .limit(1);
  return !!row;
}

async function isReplyPairIngested(db: any, commentText: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.responseExamples.id })
    .from(schema.responseExamples)
    .where(eq(schema.responseExamples.commentText, commentText))
    .limit(1);
  return !!row;
}

export async function handler(event: { body?: string } = {}) {
  const db = getDb() as any;
  const openaiApiKey = getOpenaiKey();
  const opts = { db, openaiApiKey };

  const results: string[] = [];

  try {
    // Check what's already seeded
    const [existing] = await db
      .select({ count: schema.knowledgeSources.id })
      .from(schema.knowledgeSources)
      .limit(1);

    if (existing) {
      results.push("Knowledge bank already has data — running incremental seed");
    }

    // 1. Seed podcast transcripts
    results.push(await seedPodcasts(opts));

    // 2. Seed IG captions
    results.push(await seedCaptions(opts));

    // 3. Seed reply pairs
    results.push(await seedReplyPairs(opts));

    // 4. Seed Substack
    results.push(await seedSubstack(opts));

    return {
      statusCode: 200,
      body: results.join("\n"),
    };
  } catch (err: any) {
    console.error("Seed failed:", err);
    return {
      statusCode: 500,
      body: `Seed failed: ${err.message}`,
    };
  }
}

async function seedPodcasts(opts: { db: any; openaiApiKey: string }): Promise<string> {
  // Podcast transcripts are bundled via copyFiles
  const fs = await import("fs");
  const path = await import("path");

  const podcastDir = path.resolve("/var/task/data/podcasts");
  const manifestPath = path.join(podcastDir, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return "Podcasts: skipped (no manifest)";
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const transcribed = manifest.episodes.filter(
    (e: any) => e.status === "transcribed" && e.transcriptPath && !e.skip
  );

  let ingested = 0;
  let skippedDup = 0;
  for (const ep of transcribed) {
    const filename = path.basename(ep.transcriptPath);
    const localPath = path.join(podcastDir, filename);

    if (!fs.existsSync(localPath)) continue;
    if (ep.url && await isSourceUrlIngested(opts.db, ep.url)) { skippedDup++; continue; }

    const content = fs.readFileSync(localPath, "utf-8");
    if (content.length < 100) continue;

    const isNegative = ep.contentType === "negative_coverage";

    try {
      await ingestContent(
        [
          {
            sourceType: "podcast",
            brainliftType: isNegative ? "counter_arguments" : "voice_tone",
            title: ep.title,
            content,
            sourceWeight: isNegative ? 0.8 : 1.5,
            sourceUrl: ep.url,
            metadata: { contentType: ep.contentType },
          },
        ],
        opts
      );
      ingested++;
      console.log(`  Ingested: ${ep.title} (${content.length} chars)`);
    } catch (err: any) {
      console.warn(`  Skipped podcast ${ep.title}: ${err.message}`);
    }
  }

  return `Podcasts: ${ingested} ingested, ${skippedDup} already existed`;
}

async function seedCaptions(opts: { db: any; openaiApiKey: string }): Promise<string> {
  const fs = await import("fs");
  const captionsPath = "/var/task/data/voice-samples/captions.json";

  if (!fs.existsSync(captionsPath)) {
    return "Captions: skipped (file not found)";
  }

  const captions = JSON.parse(fs.readFileSync(captionsPath, "utf-8")) as Array<{
    caption: string;
    url?: string;
  }>;

  const filtered = captions.filter((c) => c.caption && c.caption.length > 20);
  const sources: ContentSource[] = [];
  let skippedDup = 0;

  for (const c of filtered) {
    if (c.url && await isSourceUrlIngested(opts.db, c.url)) { skippedDup++; continue; }
    sources.push({
      sourceType: "ig_caption" as const,
      title: c.caption.slice(0, 100),
      content: c.caption,
      sourceWeight: 1.0,
      sourceUrl: c.url,
    });
  }

  if (sources.length === 0) return `Captions: 0 new (${skippedDup} already existed)`;
  const result = await ingestContent(sources, opts);
  return `Captions: ${result.ingested} ingested, ${result.chunks} chunks, ${skippedDup} already existed`;
}

async function seedReplyPairs(opts: { db: any; openaiApiKey: string }): Promise<string> {
  const fs = await import("fs");
  const pairsPath = "/var/task/data/voice-samples/reply-pairs.json";

  if (!fs.existsSync(pairsPath)) {
    return "Reply pairs: skipped (file not found)";
  }

  const pairs = JSON.parse(fs.readFileSync(pairsPath, "utf-8")) as Array<{
    parentComment: { text: string; username: string };
    mackenzieReply: { text: string };
    postContext?: { caption: string };
  }>;

  let count = 0;
  let skippedDup = 0;
  for (const pair of pairs) {
    if (!pair.parentComment?.text || !pair.mackenzieReply?.text) continue;
    if (await isReplyPairIngested(opts.db, pair.parentComment.text)) { skippedDup++; continue; }
    try {
      await ingestResponseExample(
        pair.parentComment.text,
        pair.mackenzieReply.text,
        true,
        "ig_scrape",
        null,
        {},
        opts
      );
      count++;
    } catch (err: any) {
      console.warn(`Skipped pair: ${err.message}`);
    }
  }

  return `Reply pairs: ${count} ingested, ${skippedDup} already existed`;
}

async function seedSubstack(opts: { db: any; openaiApiKey: string }): Promise<string> {
  const rssUrl = "https://futureofeducation.substack.com/feed";

  console.log("Fetching Substack RSS...");
  const response = await fetch(rssUrl);
  if (!response.ok) {
    return `Substack: failed (HTTP ${response.status})`;
  }

  const xml = await response.text();

  // Parse RSS items
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

  console.log(`Found ${items.length} Substack posts`);

  if (items.length === 0) {
    return "Substack: 0 posts found";
  }

  let ingested = 0;
  let skippedDup = 0;
  for (const item of items) {
    if (item.content.length < 100) continue;
    if (await isSourceUrlIngested(opts.db, item.link)) { skippedDup++; continue; }
    try {
      await ingestContent(
        [{
          sourceType: "substack" as const,
          brainliftType: "institutional" as const,
          title: item.title,
          content: item.content,
          sourceWeight: 1.2,
          sourceUrl: item.link,
        }],
        opts
      );
      ingested++;
      console.log(`  Ingested: ${item.title}`);
    } catch (err: any) {
      console.warn(`  Skipped: ${item.title} — ${err.message}`);
    }
  }

  return `Substack: ${ingested} ingested, ${skippedDup} already existed`;
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
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
