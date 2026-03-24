import { Resource } from "sst";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@instagram-commenter/core/db";
import {
  ingestContent,
  ingestResponseExample,
  type ContentSource,
} from "@instagram-commenter/core/knowledge";
import { embedBatch, chunkText } from "@instagram-commenter/core/ai";

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
  for (const ep of transcribed) {
    // The transcript path in manifest is absolute — adjust to Lambda path
    const filename = path.basename(ep.transcriptPath);
    const localPath = path.join(podcastDir, filename);

    if (!fs.existsSync(localPath)) continue;

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

  return `Podcasts: ${ingested} episodes ingested`;
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

  const sources: ContentSource[] = captions
    .filter((c) => c.caption && c.caption.length > 20)
    .map((c) => ({
      sourceType: "ig_caption" as const,
      title: c.caption.slice(0, 100),
      content: c.caption,
      sourceWeight: 1.0,
      sourceUrl: c.url,
    }));

  const result = await ingestContent(sources, opts);
  return `Captions: ${result.ingested} captions, ${result.chunks} chunks`;
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
  for (const pair of pairs) {
    if (!pair.parentComment?.text || !pair.mackenzieReply?.text) continue;
    try {
      await ingestResponseExample(
        pair.parentComment.text,
        pair.mackenzieReply.text,
        true,
        "ig_scrape",
        null,
        opts
      );
      count++;
    } catch (err: any) {
      console.warn(`Skipped pair: ${err.message}`);
    }
  }

  return `Reply pairs: ${count} pairs ingested`;
}
