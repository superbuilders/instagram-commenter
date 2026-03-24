import * as fs from "fs";
import * as path from "path";
import { createDb } from "@instagram-commenter/core/db";
import {
  ingestContent,
  ingestBrainlift,
  ingestResponseExample,
  createWorkflowyClient,
  syncBrainlifts,
} from "@instagram-commenter/core/knowledge";

const DATABASE_URL = process.env.DATABASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WORKFLOWY_API_TOKEN = process.env.WORKFLOWY_API_TOKEN;
const WORKFLOWY_BRAINLIFT_ROOT_ID = process.env.WORKFLOWY_BRAINLIFT_ROOT_ID;

if (!DATABASE_URL || !OPENAI_API_KEY) {
  console.error("DATABASE_URL and OPENAI_API_KEY are required.");
  process.exit(1);
}

const db = createDb(DATABASE_URL);
const opts = { db, openaiApiKey: OPENAI_API_KEY };

const dataDir = path.resolve(import.meta.dirname, "../data/voice-samples");

async function seedBrainlifts() {
  if (!WORKFLOWY_API_TOKEN || !WORKFLOWY_BRAINLIFT_ROOT_ID) {
    console.log(
      "Skipping BrainLift sync — WORKFLOWY_API_TOKEN and WORKFLOWY_BRAINLIFT_ROOT_ID not set."
    );
    return;
  }

  console.log("\n--- Syncing BrainLifts from WorkFlowy ---");
  const client = createWorkflowyClient(WORKFLOWY_API_TOKEN);
  const report = await syncBrainlifts(client, WORKFLOWY_BRAINLIFT_ROOT_ID);

  if (report.skipped.length > 0) {
    console.log(`\n  Skipped ${report.skipped.length} nodes:`);
    for (const s of report.skipped) {
      console.log(`    ⚠ "${s.name}" — ${s.reason}`);
    }
  }

  for (const bl of report.synced) {
    console.log(`  Ingesting: ${bl.mapping.name} (${bl.mapping.brainliftType})`);
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
    console.log(`    → ${result.chunks} chunks embedded`);
  }
}

async function seedCaptions() {
  const captionsFile = path.join(dataDir, "captions.json");
  if (!fs.existsSync(captionsFile)) {
    console.log("Skipping captions — file not found.");
    return;
  }

  console.log("\n--- Ingesting IG captions ---");
  const captions = JSON.parse(fs.readFileSync(captionsFile, "utf-8")) as Array<{
    caption: string;
    url?: string;
    timestamp?: string;
  }>;

  const sources = captions
    .filter((c) => c.caption && c.caption.length > 20)
    .map((c) => ({
      sourceType: "ig_caption" as const,
      title: c.caption.slice(0, 100),
      content: c.caption,
      sourceWeight: 1.0,
      sourceUrl: c.url,
    }));

  console.log(`  Found ${sources.length} captions to ingest`);
  const result = await ingestContent(sources, opts);
  console.log(`  → ${result.chunks} chunks embedded`);
}

async function seedReplyPairs() {
  const pairsFile = path.join(dataDir, "reply-pairs.json");
  if (!fs.existsSync(pairsFile)) {
    console.log("Skipping reply pairs — file not found.");
    return;
  }

  console.log("\n--- Ingesting MacKenzie's reply pairs ---");
  const pairs = JSON.parse(fs.readFileSync(pairsFile, "utf-8")) as Array<{
    commentText: string;
    replyText: string;
    postCaption?: string;
  }>;

  console.log(`  Found ${pairs.length} reply pairs`);
  let count = 0;
  for (const pair of pairs) {
    await ingestResponseExample(
      pair.commentText,
      pair.replyText,
      true,
      "ig_scrape",
      null,
      opts
    );
    count++;
    if (count % 20 === 0) console.log(`  → ${count}/${pairs.length} pairs ingested`);
  }
  console.log(`  → ${count} total reply pairs ingested`);
}

async function seedPodcasts() {
  const podcastDir = path.resolve(dataDir, "../podcasts");
  const manifestPath = path.join(podcastDir, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    console.log("Skipping podcasts — no manifest found.");
    return;
  }

  console.log("\n--- Ingesting podcast transcripts ---");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
    episodes: Array<{
      title: string;
      url: string;
      status: string;
      skip?: boolean;
      contentType?: string;
      transcriptPath?: string | null;
    }>;
  };

  const transcribed = manifest.episodes.filter(
    (e) => e.status === "transcribed" && e.transcriptPath && !e.skip
  );

  console.log(`  Found ${transcribed.length} transcribed episodes`);

  const resolveTranscriptPath = (transcriptPath: string) => {
    if (!path.isAbsolute(transcriptPath)) {
      return path.resolve(podcastDir, transcriptPath);
    }

    if (fs.existsSync(transcriptPath)) {
      return transcriptPath;
    }

    return path.resolve(podcastDir, path.basename(transcriptPath));
  };

  const sources = transcribed
    .map((ep) => {
      if (!ep.transcriptPath) return null;
      const transcriptPath = resolveTranscriptPath(ep.transcriptPath);
      if (!fs.existsSync(transcriptPath)) return null;
      const content = fs.readFileSync(transcriptPath, "utf-8");
      if (content.length < 100) return null;

      const isNegative = ep.contentType === "negative_coverage";
      return {
        sourceType: "podcast" as const,
        brainliftType: isNegative
          ? ("counter_arguments" as const)
          : ("voice_tone" as const),
        title: ep.title,
        content,
        sourceWeight: isNegative ? 0.8 : 1.5,
        sourceUrl: ep.url,
        metadata: { contentType: ep.contentType },
      };
    })
    .filter(Boolean) as Array<import("@instagram-commenter/core/knowledge").ContentSource>;

  console.log(`  ${sources.length} episodes to ingest`);
  const result = await ingestContent(sources, opts);
  console.log(`  → ${result.chunks} chunks embedded`);
}

async function main() {
  console.log("=== Knowledge Bank Seed ===");

  await seedBrainlifts();
  await seedCaptions();
  await seedReplyPairs();
  await seedPodcasts();

  console.log("\n=== Seed complete ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
