import { sql, and, eq, gt, desc } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { knowledgeSources, responseExamples } from "../db/schema.js";
import { embedText } from "../ai/embeddings.js";

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

const RELEVANT_KNOWLEDGE_THRESHOLD = 0.5;
const POSITIVE_EXAMPLE_THRESHOLD = 0.65;
const NEGATIVE_EXAMPLE_THRESHOLD = 0.72;
const LEARNED_SKIP_THRESHOLD = 0.78;
const HARD_SKIP_REVIEW_REASONS = new Set(["should_not_reply"]);

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
      similarity: similarityExpr,
    })
    .from(knowledgeSources)
    .where(and(...conditions))
    .orderBy(desc(sql`${similarityExpr} * ${knowledgeSources.sourceWeight}`))
    .limit(limit);

  return results as SearchResult[];
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
  opts: SearchOptions
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

  const [initialKnowledge, allPositiveExamples, allNegativeExamples] = await Promise.all([
    searchKnowledge(commentText, knowledgeOpts),
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

  let knowledge = initialKnowledge;
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
