export interface AllocatableComment {
  id: string;
  classificationGroup:
    | "narrative_shaping"
    | "community_building"
    | "informational";
  likesCount: number;
}

const PRIORITY_ORDER: AllocatableComment["classificationGroup"][] = [
  "narrative_shaping",
  "community_building",
  "informational",
];

export function allocateReplies(
  comments: AllocatableComment[],
  remainingBudget: number
): AllocatableComment[] {
  if (remainingBudget <= 0) return [];

  const sorted = [...comments].sort((a, b) => {
    const aPriority = PRIORITY_ORDER.indexOf(a.classificationGroup);
    const bPriority = PRIORITY_ORDER.indexOf(b.classificationGroup);
    if (aPriority !== bPriority) return aPriority - bPriority;
    return b.likesCount - a.likesCount;
  });

  return sorted.slice(0, remainingBudget);
}
