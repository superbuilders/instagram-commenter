import { eq } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { knowledgeSources, brainliftSources } from "../db/schema.js";
import { embedBatch, chunkText } from "../ai/embeddings.js";
import { CLASSIFIER_POLICY_VERSION } from "../pipeline/index.js";

const PODCAST_AD_PATTERNS = [
  /\bword from our sponsors?\b/i,
  /\bthis episode is brought to you by\b/i,
  /\boracle cloud infrastructure\b/i,
  /\bnetsuite by oracle\b/i,
  /\bbuild the future of multi-agent software with agency\b/i,
  /\ba-g-n-t-c-y\b/i,
  /\bpreserve gold\b/i,
  /\btext dr\.?\s*phil to 50505\b/i,
  /\boracle\.com slash cognitive\b/i,
  /\bnetsuite\.com slash cognitive\b/i,
  /\bagency\.org\b/i,
  /\bfree gold and silver\b/i,
] as const;
const PODCAST_AD_CONTEXT_RADIUS = 2;

export interface IngestOptions {
  db: Database;
  openaiApiKey: string;
}

export interface ContentSource {
  sourceType:
    | "brainlift"
    | "ig_caption"
    | "ig_reply"
    | "substack"
    | "podcast"
    | "website"
    | "slack_approved"
    | "slack_edited";
  brainliftType?:
    | "counter_arguments"
    | "voice_tone"
    | "institutional"
    | "deletion_guidelines"
    | "messaging_boundaries";
  title: string;
  content: string;
  sourceWeight?: number;
  narrativeTopics?: string[];
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface BrainliftContent extends ContentSource {
  sourceType: "brainlift";
  brainliftType: NonNullable<ContentSource["brainliftType"]>;
  workflowyNodeId: string;
  contentHash: string;
}

function stripPodcastAds(content: string): string {
  const sentences = content.match(/[^.!?]+[.!?]?/g);
  if (!sentences || sentences.length === 0) return content;

  const adSentenceIndexes = new Set<number>();
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const isAdSentence = PODCAST_AD_PATTERNS.some((pattern) =>
      pattern.test(sentence)
    );
    if (!isAdSentence) continue;

    const start = Math.max(0, i - PODCAST_AD_CONTEXT_RADIUS);
    const end = Math.min(sentences.length - 1, i + PODCAST_AD_CONTEXT_RADIUS);
    for (let j = start; j <= end; j++) adSentenceIndexes.add(j);
  }

  if (adSentenceIndexes.size === 0) return content;

  const filtered = sentences
    .filter((_, idx) => !adSentenceIndexes.has(idx))
    .join("")
    .replace(/\n{3,}/g, "\n\n");

  return filtered.trim().length > 0 ? filtered : content;
}

export async function ingestContent(
  sources: ContentSource[],
  opts: IngestOptions
): Promise<{ ingested: number; chunks: number }> {
  let totalChunks = 0;

  for (const source of sources) {
    const content =
      source.sourceType === "podcast"
        ? stripPodcastAds(source.content)
        : source.content;
    const chunks = chunkText(content);
    if (chunks.length === 0) continue;

    const embedded = await embedBatch(chunks, opts.openaiApiKey);

    for (const item of embedded) {
      await opts.db.insert(knowledgeSources).values({
        sourceType: source.sourceType,
        brainliftType: source.brainliftType ?? null,
        title: source.title,
        content: item.text,
        embedding: item.embedding,
        sourceWeight: source.sourceWeight ?? 1.0,
        narrativeTopics: source.narrativeTopics ?? [],
        sourceUrl: source.sourceUrl ?? null,
        metadata: source.metadata ?? null,
      });
    }

    totalChunks += embedded.length;
  }

  return { ingested: sources.length, chunks: totalChunks };
}

export async function ingestBrainlift(
  source: BrainliftContent,
  opts: IngestOptions
): Promise<{ chunks: number }> {
  const existing = await opts.db
    .select()
    .from(brainliftSources)
    .where(eq(brainliftSources.workflowyNodeId, source.workflowyNodeId));

  if (existing.length > 0 && existing[0].contentHash === source.contentHash) {
    return { chunks: 0 };
  }

  if (existing.length > 0) {
    for (const entry of existing) {
      await opts.db
        .delete(knowledgeSources)
        .where(eq(knowledgeSources.id, entry.knowledgeSourceId));
      await opts.db
        .delete(brainliftSources)
        .where(eq(brainliftSources.id, entry.id));
    }
  }

  const chunks = chunkText(source.content);
  if (chunks.length === 0) return { chunks: 0 };

  const embedded = await embedBatch(chunks, opts.openaiApiKey);

  for (const item of embedded) {
    const [inserted] = await opts.db
      .insert(knowledgeSources)
      .values({
        sourceType: "brainlift",
        brainliftType: source.brainliftType,
        title: source.title,
        content: item.text,
        embedding: item.embedding,
        sourceWeight: source.sourceWeight ?? 1.0,
        narrativeTopics: source.narrativeTopics ?? [],
        sourceUrl: source.sourceUrl ?? null,
        metadata: source.metadata ?? null,
      })
      .returning({ id: knowledgeSources.id });

    await opts.db.insert(brainliftSources).values({
      knowledgeSourceId: inserted.id,
      workflowyNodeId: source.workflowyNodeId,
      brainliftType: source.brainliftType,
      lastSyncedAt: new Date(),
      contentHash: source.contentHash,
    });
  }

  return { chunks: embedded.length };
}

export async function ingestResponseExample(
  commentText: string,
  responseText: string,
  isPositive: boolean,
  source: string,
  classificationGroup: string | null,
  metadata: {
    reviewReason?: string | null;
    reviewNotes?: string | null;
    originalReplyId?: string | null;
    policyVersion?: string | null;
  } = {},
  opts: IngestOptions
): Promise<void> {
  const { responseExamples } = await import("../db/schema.js");
  const [embedded] = await embedBatch(
    [`Comment: ${commentText}\nResponse: ${responseText}`],
    opts.openaiApiKey
  );

  await opts.db.insert(responseExamples).values({
    commentText,
    responseText,
    isPositive,
    source,
    classificationGroup: classificationGroup as any,
    reviewReason: metadata.reviewReason ?? null,
    reviewNotes: metadata.reviewNotes ?? null,
    originalReplyId: metadata.originalReplyId ?? null,
    policyVersion: metadata.policyVersion ?? CLASSIFIER_POLICY_VERSION,
    embedding: embedded.embedding,
  });
}
