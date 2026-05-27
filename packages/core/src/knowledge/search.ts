import { sql, and, eq, gt, desc } from "drizzle-orm";
import type { Database } from "../db/index.js";
import {
  bioDestinationSnapshots,
  bioDestinations,
  knowledgeSources,
  postContexts,
  responseExamples,
} from "../db/schema.js";
import { embedText } from "../ai/embeddings.js";
import type { PostContext } from "../post-context/index.js";

export interface SearchOptions {
  db: Database;
  openaiApiKey: string;
}

export interface SearchResult {
  id: string;
  title: string | null;
  content: string;
  sourceType: string;
  brainliftType: string | null;
  sourceWeight: number;
  narrativeTopics: string[] | null;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  similarity: number;
}

export interface ExampleResult {
  id: string;
  commentText: string;
  responseText: string;
  isPositive: boolean;
  source: string;
  classificationGroup: string | null;
  reviewReason: string | null;
  reviewNotes: string | null;
  similarity: number;
}

export interface RetrievalResult {
  knowledge: SearchResult[];
  examples: ExampleResult[];
  positiveExamples: ExampleResult[];
  negativeExamples: ExampleResult[];
  learnedSkipMatch: ExampleResult | null;
  hasRelevantKnowledge: boolean;
}

export function postContextToSearchResult(context: PostContext): SearchResult | null {
  const transcript = context.transcript?.trim();
  if (!transcript) return null;

  return {
    id: context.id,
    title: "Current post transcript",
    content: transcript,
    sourceType: "post_context",
    brainliftType: "institutional",
    sourceWeight: 1.5,
    narrativeTopics: [],
    sourceUrl: context.sourceUrl,
    metadata: {
      postId: context.postId,
      durationSeconds: context.durationSeconds,
      thumbnailUrl: context.thumbnailUrl,
    },
    similarity: 1,
  };
}

export interface BioDestinationSnapshotCandidate {
  destinationId: string;
  title: string;
  url: string;
  visibleText: string;
}

const RELEVANT_KNOWLEDGE_THRESHOLD = 0.5;
const RELEVANT_BIO_DESTINATION_THRESHOLD = 0.3;
const POSITIVE_EXAMPLE_THRESHOLD = 0.65;
const NEGATIVE_EXAMPLE_THRESHOLD = 0.72;
const LEARNED_SKIP_THRESHOLD = 0.78;
const HARD_SKIP_REVIEW_REASONS = new Set(["should_not_reply"]);

const BIO_DESTINATION_SYNONYMS: Record<string, string[]> = {
  teacher: ["guide", "guides"],
  teachers: ["guide", "guides"],
  teach: ["guide", "guides"],
  job: ["career", "careers", "apply", "application"],
  jobs: ["career", "careers", "apply", "application"],
  open: ["bring", "city", "start"],
  start: ["bring", "city", "open"],
  tuition: ["cost", "price", "pricing"],
  school: ["alpha"],
};

function tokens(value: string): Set<string> {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);

  const expanded = new Set(base);
  for (const token of base) {
    for (const synonym of BIO_DESTINATION_SYNONYMS[token] ?? []) {
      expanded.add(synonym);
    }
  }

  return expanded;
}

export function rankBioDestinationSnapshots(
  query: string,
  snapshots: BioDestinationSnapshotCandidate[],
  limit = 3
): SearchResult[] {
  const queryTokens = tokens(query);
  if (queryTokens.size === 0) return [];

  return snapshots
    .map((snapshot) => {
      const contentTokens = tokens(`${snapshot.title} ${snapshot.visibleText}`);
      const matches = [...queryTokens].filter((token) => contentTokens.has(token));
      const similarity = matches.length / queryTokens.size;
      return {
        id: snapshot.destinationId,
        title: snapshot.title,
        content: snapshot.visibleText,
        sourceType: "bio_destination",
        brainliftType: "institutional",
        sourceWeight: 1.2,
        narrativeTopics: [],
        sourceUrl: snapshot.url,
        metadata: { destinationId: snapshot.destinationId },
        similarity,
      } satisfies SearchResult;
    })
    .filter((result) => result.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export async function searchKnowledge(
  query: string,
  opts: SearchOptions & {
    classificationGroup?: string;
    brainliftType?: string;
    narrativeTopic?: string;
    limit?: number;
    minSimilarity?: number;
  }
): Promise<SearchResult[]> {
  const embedding = await embedText(query, opts.openaiApiKey);
  const limit = opts.limit ?? 5;
  const minSimilarity = opts.minSimilarity ?? 0.3;

  const similarityExpr = sql<number>`1 - (${knowledgeSources.embedding} <=> ${JSON.stringify(embedding)}::vector)`;

  const conditions = [gt(similarityExpr, minSimilarity)];

  if (opts.brainliftType) {
    conditions.push(
      eq(knowledgeSources.brainliftType, opts.brainliftType as any)
    );
  }

  if (opts.narrativeTopic) {
    conditions.push(
      sql`${opts.narrativeTopic} = ANY(${knowledgeSources.narrativeTopics})`
    );
  }

  const results = await opts.db
    .select({
      id: knowledgeSources.id,
      title: knowledgeSources.title,
      content: knowledgeSources.content,
      sourceType: knowledgeSources.sourceType,
      brainliftType: knowledgeSources.brainliftType,
      sourceWeight: knowledgeSources.sourceWeight,
      narrativeTopics: knowledgeSources.narrativeTopics,
      sourceUrl: knowledgeSources.sourceUrl,
      metadata: knowledgeSources.metadata,
      similarity: similarityExpr,
    })
    .from(knowledgeSources)
    .where(and(...conditions))
    .orderBy(desc(sql`${similarityExpr} * ${knowledgeSources.sourceWeight}`))
    .limit(limit);

  return results as SearchResult[];
}

export async function searchBioDestinationSnapshots(
  query: string,
  opts: SearchOptions & {
    accountId?: string;
    limit?: number;
  }
): Promise<SearchResult[]> {
  const rows = await opts.db
    .select({
      destinationId: bioDestinations.id,
      accountId: bioDestinations.accountId,
      title: bioDestinationSnapshots.title,
      url: bioDestinationSnapshots.url,
      visibleText: bioDestinationSnapshots.visibleText,
      fetchedAt: bioDestinationSnapshots.fetchedAt,
    })
    .from(bioDestinationSnapshots)
    .innerJoin(
      bioDestinations,
      eq(bioDestinationSnapshots.destinationId, bioDestinations.id)
    )
    .where(
      and(
        eq(bioDestinations.status, "active"),
        eq(bioDestinationSnapshots.fetchStatus, "succeeded"),
        opts.accountId ? eq(bioDestinations.accountId, opts.accountId) : sql`true`
      )
    )
    .orderBy(desc(bioDestinationSnapshots.fetchedAt))
    .limit(100);

  const latestByDestination = new Map<string, BioDestinationSnapshotCandidate>();
  for (const row of rows) {
    if (latestByDestination.has(row.destinationId)) continue;
    latestByDestination.set(row.destinationId, {
      destinationId: row.destinationId,
      title: row.title,
      url: row.url,
      visibleText: row.visibleText,
    });
  }

  return rankBioDestinationSnapshots(
    query,
    [...latestByDestination.values()],
    opts.limit
  ).filter((result) => result.similarity >= RELEVANT_BIO_DESTINATION_THRESHOLD);
}

export async function searchPostContext(
  opts: SearchOptions & { postId?: string | null }
): Promise<SearchResult[]> {
  if (!opts.postId) return [];

  const [row] = await opts.db
    .select()
    .from(postContexts)
    .where(eq(postContexts.postId, opts.postId))
    .limit(1);

  const result = row
    ? postContextToSearchResult({
        id: row.id,
        postId: row.postId,
        transcript: row.transcript,
        durationSeconds: row.durationSeconds,
        thumbnailUrl: row.thumbnailUrl,
        sourceUrl: row.sourceUrl,
        metadata: row.metadata as Record<string, unknown> | null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })
    : null;

  return result ? [result] : [];
}

export async function searchExamples(
  query: string,
  opts: SearchOptions & {
    classificationGroup?: string;
    positiveOnly?: boolean;
    negativeOnly?: boolean;
    limit?: number;
    minSimilarity?: number;
  }
): Promise<ExampleResult[]> {
  if (opts.positiveOnly && opts.negativeOnly) {
    throw new Error("searchExamples cannot use both positiveOnly and negativeOnly");
  }

  const embedding = await embedText(query, opts.openaiApiKey);
  const limit = opts.limit ?? 5;
  const minSimilarity = opts.minSimilarity ?? 0.3;

  const similarityExpr = sql<number>`1 - (${responseExamples.embedding} <=> ${JSON.stringify(embedding)}::vector)`;

  const conditions = [gt(similarityExpr, minSimilarity)];

  if (opts.classificationGroup) {
    conditions.push(
      eq(responseExamples.classificationGroup, opts.classificationGroup as any)
    );
  }

  if (opts.positiveOnly) {
    conditions.push(eq(responseExamples.isPositive, true));
  }

  if (opts.negativeOnly) {
    conditions.push(eq(responseExamples.isPositive, false));
  }

  const results = await opts.db
    .select({
      id: responseExamples.id,
      commentText: responseExamples.commentText,
      responseText: responseExamples.responseText,
      isPositive: responseExamples.isPositive,
      source: responseExamples.source,
      classificationGroup: responseExamples.classificationGroup,
      reviewReason: responseExamples.reviewReason,
      reviewNotes: responseExamples.reviewNotes,
      similarity: similarityExpr,
    })
    .from(responseExamples)
    .where(and(...conditions))
    .orderBy(desc(similarityExpr))
    .limit(limit);

  return results as ExampleResult[];
}

export function findLearnedSkipMatch(
  negativeExamples: ExampleResult[],
  threshold = LEARNED_SKIP_THRESHOLD
): ExampleResult | null {
  return (
    negativeExamples.find(
      (example) =>
        !example.isPositive &&
        example.similarity >= threshold &&
        example.reviewReason != null &&
        HARD_SKIP_REVIEW_REASONS.has(example.reviewReason)
    ) ?? null
  );
}

export async function retrieveForComment(
  commentText: string,
  classificationGroup: string,
  narrativeTopic: string | null,
  opts: SearchOptions & { postId?: string | null }
): Promise<RetrievalResult> {
  const knowledgeOpts: Parameters<typeof searchKnowledge>[1] = {
    ...opts,
    limit: 5,
    minSimilarity: 0.45,
  };

  if (classificationGroup === "narrative_shaping") {
    knowledgeOpts.brainliftType = "counter_arguments";
    if (narrativeTopic) knowledgeOpts.narrativeTopic = narrativeTopic;
  } else if (classificationGroup === "informational") {
    knowledgeOpts.brainliftType = "institutional";
  }

  const [
    initialKnowledge,
    postContextKnowledge,
    bioDestinationKnowledge,
    allPositiveExamples,
    allNegativeExamples,
  ] = await Promise.all([
    searchKnowledge(commentText, knowledgeOpts),
    searchPostContext(opts),
    classificationGroup === "informational"
      ? searchBioDestinationSnapshots(commentText, {
          ...opts,
          limit: 3,
        })
      : Promise.resolve([]),
    searchExamples(commentText, {
      ...opts,
      classificationGroup,
      positiveOnly: true,
      limit: 3,
      minSimilarity: 0.3,
    }),
    searchExamples(commentText, {
      ...opts,
      classificationGroup,
      negativeOnly: true,
      limit: 5,
      minSimilarity: 0.3,
    }),
  ]);

  let knowledge = [
    ...postContextKnowledge,
    ...bioDestinationKnowledge,
    ...initialKnowledge,
  ];
  if (
    classificationGroup === "narrative_shaping" &&
    narrativeTopic &&
    (knowledge.length === 0 ||
      knowledge[0].similarity <= RELEVANT_KNOWLEDGE_THRESHOLD)
  ) {
    const fallbackKnowledge = await searchKnowledge(commentText, {
      ...opts,
      brainliftType: "counter_arguments",
      limit: 5,
      minSimilarity: 0.45,
    });

    if (
      fallbackKnowledge.length > 0 &&
      (knowledge.length === 0 ||
        fallbackKnowledge[0].similarity > knowledge[0].similarity)
    ) {
      knowledge = fallbackKnowledge;
    }
  }

  // Only include examples with strong similarity. Weak examples add noise.
  const positiveExamples = allPositiveExamples.filter(
    (e) => e.similarity > POSITIVE_EXAMPLE_THRESHOLD
  );
  const negativeExamples = allNegativeExamples.filter(
    (e) => e.similarity > NEGATIVE_EXAMPLE_THRESHOLD
  );

  const hasRelevantKnowledge =
    knowledge.length > 0 &&
    knowledge[0].similarity > RELEVANT_KNOWLEDGE_THRESHOLD;
  const learnedSkipMatch = findLearnedSkipMatch(negativeExamples);

  return {
    knowledge,
    examples: positiveExamples,
    positiveExamples,
    negativeExamples,
    learnedSkipMatch,
    hasRelevantKnowledge,
  };
}
