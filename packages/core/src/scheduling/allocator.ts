export interface AllocatableComment {
  id: string;
  classificationGroup:
    | "narrative_shaping"
    | "community_building"
    | "informational";
  likesCount: number;
  text?: string;
  postCaption?: string | null;
  classificationConfidence?: number | null;
  narrativeTopic?: string | null;
  infoType?: string | null;
}

export interface AllocatedComment extends AllocatableComment {
  allocationScore: number;
  allocationReasons: string[];
}

const PRIORITY_ORDER: AllocatableComment["classificationGroup"][] = [
  "narrative_shaping",
  "informational",
  "community_building",
];

const GROUP_BASE_SCORE: Record<AllocatableComment["classificationGroup"], number> = {
  narrative_shaping: 300,
  informational: 225,
  community_building: 75,
};

const LOW_VALUE_PHRASES = new Set([
  "agreed",
  "amazing",
  "amen",
  "awesome",
  "beautiful",
  "cool",
  "exactly",
  "facts",
  "great",
  "incredible",
  "inspiring",
  "love",
  "love it",
  "love that",
  "love this",
  "love you",
  "needed this",
  "nice",
  "so good",
  "so inspiring",
  "so true",
  "thank you",
  "thanks",
  "this",
  "this is amazing",
  "this is everything",
  "this is so inspiring",
  "truth",
  "wow",
  "yes",
  "yes please",
  "yep",
]);

const ARGUMENT_VERB_RE =
  /\b(because|but|however|think|believe|need|needs|should|cannot|can't|won't|don't|doesn't|isn't|aren't|wrong|harm|hurts|replace|replacing|instead|unless|without)\b|kids need|children need/;

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'?]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasQuestionIntent(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    text.includes("?") ||
    /\b(how|what|where|when|why|can|could|do|does|is|are|will|would|should)\b/.test(
      normalized
    )
  );
}

function isEmojiOrPunctuationOnly(text: string): boolean {
  return normalizeText(text).length === 0;
}

function isTeacherGiveawayCaption(caption: string | null | undefined): boolean {
  if (!caption) return false;
  const normalized = normalizeText(caption);
  return (
    normalized.includes("giveaway") &&
    (normalized.includes("teacher") || normalized.includes("teach"))
  );
}

function looksLikeTeacherGiveawayEntry(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized || hasQuestionIntent(text)) return false;

  const words = normalized.split(" ");
  if (words.length > 8) return false;

  return (
    /\b(k|pre k|prek|kindergarten|grade|grades|teacher|math|science|reading|ela|english|history|social studies|art|music|pe|stem|steam|spanish|sped|special ed|elementary|middle school|high school|librarian|counselor)\b/.test(
      normalized
    ) ||
    /^\d+(st|nd|rd|th)?$/.test(normalized)
  );
}

export function isLowValueCommunityComment(
  comment: Pick<AllocatableComment, "classificationGroup" | "text" | "postCaption">
): boolean {
  if (comment.classificationGroup !== "community_building") return false;
  const text = comment.text?.trim() ?? "";
  if (!text) return true;

  if (isEmojiOrPunctuationOnly(text)) return true;
  if (hasQuestionIntent(text)) return false;

  const normalized = normalizeText(text);
  const words = normalized ? normalized.split(" ") : [];

  if (LOW_VALUE_PHRASES.has(normalized)) return true;
  if (words.length <= 6) return true;

  if (
    isTeacherGiveawayCaption(comment.postCaption) &&
    looksLikeTeacherGiveawayEntry(text)
  ) {
    return true;
  }

  return false;
}

export function isLowValueNarrativeFluff(
  comment: Pick<AllocatableComment, "classificationGroup" | "text">
): boolean {
  if (comment.classificationGroup !== "narrative_shaping") return false;
  const text = comment.text?.trim() ?? "";
  if (!text) return true;
  if (text.includes("?")) return false;

  const normalized = normalizeText(text);
  const words = normalized ? normalized.split(" ") : [];
  const hasArgument = ARGUMENT_VERB_RE.test(normalized);

  if (hasArgument && words.length > 4) return false;
  if (isEmojiOrPunctuationOnly(text)) return true;
  if (words.length <= 8 && !hasArgument) return true;
  if (words.length <= 6) return true;

  return false;
}

export function scoreReplyCandidate(comment: AllocatableComment): AllocatedComment {
  const allocationReasons: string[] = [comment.classificationGroup];
  let allocationScore = GROUP_BASE_SCORE[comment.classificationGroup];

  if (comment.likesCount > 0) {
    allocationScore += Math.min(100, comment.likesCount * 5);
    allocationReasons.push(`${comment.likesCount}_likes`);
  }

  if (comment.classificationConfidence != null) {
    allocationScore += Math.round(comment.classificationConfidence * 20);
  }

  if (comment.narrativeTopic) {
    allocationScore += 20;
    allocationReasons.push(`topic_${comment.narrativeTopic}`);
  }

  if (comment.infoType) {
    allocationScore += 10;
    allocationReasons.push(`info_${comment.infoType}`);
  }

  return { ...comment, allocationScore, allocationReasons };
}

export function allocateReplies(
  comments: AllocatableComment[],
  remainingBudget: number
): AllocatedComment[] {
  if (remainingBudget <= 0) return [];

  const scored = comments
    .filter(
      (comment) =>
        !isLowValueCommunityComment(comment) && !isLowValueNarrativeFluff(comment)
    )
    .map(scoreReplyCandidate);

  const sorted = scored.sort((a, b) => {
    if (b.allocationScore !== a.allocationScore) {
      return b.allocationScore - a.allocationScore;
    }
    const aPriority = PRIORITY_ORDER.indexOf(a.classificationGroup);
    const bPriority = PRIORITY_ORDER.indexOf(b.classificationGroup);
    if (aPriority !== bPriority) return aPriority - bPriority;
    return b.likesCount - a.likesCount;
  });

  const priority = sorted.filter(
    (comment) => comment.classificationGroup !== "community_building"
  );
  const community = sorted.filter(
    (comment) => comment.classificationGroup === "community_building"
  );

  const selected = priority.slice(0, remainingBudget);
  const leftover = remainingBudget - selected.length;
  const communityCap = Math.max(1, Math.floor(remainingBudget * 0.2));
  selected.push(...community.slice(0, Math.min(leftover, communityCap)));

  return selected;
}
