import { describe, expect, test } from "vitest";
import { buildApprovalMessage } from "../blocks.js";

describe("buildApprovalMessage", () => {
  test("shows why a reply was surfaced", () => {
    const message = buildApprovalMessage(
      {
        id: "comment-1",
        text: "AI cannot replace a real teacher.",
        authorUsername: "parent",
        likesCount: 12,
        postCaption: "How Alpha uses AI.",
        postPermalink: "https://instagram.com/p/example",
      },
      {
        id: "reply-1",
        text: "AI handles academics so our guides can focus on motivation and life skills.",
        classificationGroup: "narrative_shaping",
        confidence: 0.92,
        narrativeTopic: "ai_education",
        allocationScore: 385,
        allocationReasons: ["narrative_shaping", "12_likes", "topic_ai_education"],
        knowledgeCount: 2,
        topKnowledgeSimilarity: 0.78,
        positiveExampleCount: 1,
        topPositiveExampleSimilarity: 0.73,
        negativeExampleCount: 1,
        topNegativeExampleSimilarity: 0.66,
        negativeWarningReason: "off_brand_voice",
      },
      "How Alpha uses AI."
    );

    const payload = JSON.stringify(message.blocks);

    expect(payload).toContain("Why surfaced");
    expect(payload).toContain("score 385");
    expect(payload).toContain("knowledge 2");
    expect(payload).toContain("rejected examples 1");
  });
});
