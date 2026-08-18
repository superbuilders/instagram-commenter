import type { Database } from "../db/index.js";
import { commentPipelineEvents } from "../db/schema.js";

export const CLASSIFIER_POLICY_VERSION = "2026-08-18-v1";
export const CLASSIFIER_PROMPT_VERSION = "2026-08-18-v1";
export const CLASSIFIER_MODEL = "claude-sonnet-4-20250514";
export const GENERATOR_PROMPT_VERSION = "2026-05-22-v1";
export const GENERATOR_MODEL = "claude-sonnet-4-20250514";
export const VERIFIER_PROMPT_VERSION = "2026-04-04-v1";
export const VERIFIER_MODEL = "claude-haiku-4-5-20251001";

export const REJECT_REASONS = [
  "wrong_classification",
  "off_brand_voice",
  "not_specific_enough",
  "factually_risky",
  "too_defensive",
  "should_not_reply",
  "other",
] as const;

export const EDIT_CATEGORIES = [
  "voice_tweak",
  "factual_fix",
  "specificity_fix",
  "safety_fix",
  "other",
] as const;

export type RejectReason = (typeof REJECT_REASONS)[number];
export type EditCategory = (typeof EDIT_CATEGORIES)[number];

export type PipelineStage =
  | "ingest"
  | "classify"
  | "allocate"
  | "retrieve"
  | "generate"
  | "verify"
  | "slack_review"
  | "post_reply"
  | "delete_review"
  | "delete_execute";

export type PipelineStatus = "started" | "succeeded" | "skipped" | "failed";

export function getReviewOutcomeCategory(reason: string | null | undefined): string | null {
  switch (reason) {
    case "wrong_classification":
      return "classification";
    case "off_brand_voice":
    case "too_defensive":
      return "voice";
    case "not_specific_enough":
      return "specificity";
    case "factually_risky":
      return "safety";
    case "should_not_reply":
      return "routing";
    case "voice_tweak":
      return "voice";
    case "factual_fix":
      return "safety";
    case "specificity_fix":
      return "specificity";
    case "safety_fix":
      return "safety";
    case "other":
      return "operator";
    default:
      return null;
  }
}

export async function recordPipelineEvent(
  db: Database,
  event: {
    commentId: string;
    replyId?: string | null;
    stage: PipelineStage;
    status: PipelineStatus;
    reasonCode?: string | null;
    reasonDetail?: string | null;
    payload?: Record<string, unknown> | null;
    model?: string | null;
    promptVersion?: string | null;
    latencyMs?: number | null;
  }
): Promise<void> {
  await db.insert(commentPipelineEvents).values({
    commentId: event.commentId,
    replyId: event.replyId ?? null,
    stage: event.stage,
    status: event.status,
    reasonCode: event.reasonCode ?? null,
    reasonDetail: event.reasonDetail ?? null,
    payload: event.payload ?? null,
    model: event.model ?? null,
    promptVersion: event.promptVersion ?? null,
    latencyMs: event.latencyMs ?? null,
  });
}
