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
  classificationGroup: string | null;
  similarity: number;
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
    limit?: number;
    minSimilarity?: number;
  }
): Promise<ExampleResult[]> {
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

  const results = await opts.db
    .select({
      id: responseExamples.id,
      commentText: responseExamples.commentText,
      responseText: responseExamples.responseText,
      isPositive: responseExamples.isPositive,
      classificationGroup: responseExamples.classificationGroup,
      similarity: similarityExpr,
    })
    .from(responseExamples)
    .where(and(...conditions))
    .orderBy(desc(similarityExpr))
    .limit(limit);

  return results as ExampleResult[];
}

export async function retrieveForComment(
  commentText: string,
  classificationGroup: string,
  narrativeTopic: string | null,
  opts: SearchOptions
): Promise<{
  knowledge: SearchResult[];
  examples: ExampleResult[];
  hasRelevantKnowledge: boolean;
}> {
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

  const [knowledge, allExamples] = await Promise.all([
    searchKnowledge(commentText, knowledgeOpts),
    searchExamples(commentText, {
      ...opts,
      classificationGroup,
      positiveOnly: true,
      limit: 3,
      minSimilarity: 0.3,
    }),
  ]);

  // Only include examples with strong similarity — weak examples add noise
  const examples = allExamples.filter((e) => e.similarity > 0.65);

  const hasRelevantKnowledge =
    knowledge.length > 0 && knowledge[0].similarity > 0.5;

  return { knowledge, examples, hasRelevantKnowledge };
}
