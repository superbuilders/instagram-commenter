export interface KnowledgeGapInput {
  commentId: string;
  text: string;
  topic: string | null;
  classificationGroup: string | null;
  permalink: string | null;
  likesCount: number;
}

export interface KnowledgeGapInventoryEntry {
  topic: string;
  missingSourceType: "bio_destination_or_verified_knowledge" | "counter_argument" | "post_context";
  commentCount: number;
  examples: Array<{
    commentId: string;
    text: string;
    permalink: string | null;
    likesCount: number;
  }>;
}

function missingSourceTypeFor(
  group: string | null
): KnowledgeGapInventoryEntry["missingSourceType"] {
  if (group === "narrative_shaping") return "counter_argument";
  return "bio_destination_or_verified_knowledge";
}

export function buildKnowledgeGapInventory(
  rows: KnowledgeGapInput[],
  exampleLimitPerTopic = 3
): KnowledgeGapInventoryEntry[] {
  const groups = new Map<string, KnowledgeGapInput[]>();

  for (const row of rows) {
    const topic = row.topic ?? row.classificationGroup ?? "general";
    groups.set(topic, [...(groups.get(topic) ?? []), row]);
  }

  return [...groups.entries()]
    .map(([topic, groupedRows]) => {
      const sortedRows = [...groupedRows].sort(
        (a, b) => b.likesCount - a.likesCount
      );
      return {
        topic,
        missingSourceType: missingSourceTypeFor(sortedRows[0]?.classificationGroup ?? null),
        commentCount: groupedRows.length,
        examples: sortedRows.slice(0, exampleLimitPerTopic).map((row) => ({
          commentId: row.commentId,
          text: row.text,
          permalink: row.permalink,
          likesCount: row.likesCount,
        })),
      };
    })
    .sort((a, b) => b.commentCount - a.commentCount);
}
