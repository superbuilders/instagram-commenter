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

  test("shows Bio Destination evidence used to ground a reply", () => {
    const message = buildApprovalMessage(
      {
        id: "comment-1",
        text: "How do I become a teacher at Alpha?",
        authorUsername: "teacher",
        likesCount: 2,
        postCaption: "Our guides are incredible.",
      },
      {
        id: "reply-1",
        text: "There is a Become a Guide link in my bio with more info.",
        classificationGroup: "informational",
        confidence: 0.91,
        infoType: "program",
        evidenceSources: [
          {
            sourceType: "bio_destination",
            title: "Become a Guide",
            url: "https://alpha.school/guides",
            snippet: "Apply to become an Alpha Guide.",
            similarity: 0.67,
          },
          {
            sourceType: "post_context",
            title: "Current post transcript",
            url: "https://instagram.com/reel/example",
            snippet: "The video explains that guides support students.",
            similarity: 1,
          },
          {
            sourceType: "approved_example",
            title: "Approved example",
            snippet: "A prior approved reply used this wording.",
            similarity: 0.75,
          },
        ],
      },
      "Our guides are incredible."
    );

    const payload = JSON.stringify(message.blocks);

    expect(payload).toContain("Evidence used");
    expect(payload).toContain("Become a Guide");
    expect(payload).toContain("Current post transcript");
    expect(payload).toContain("Approved example");
    expect(payload).toContain("https://alpha.school/guides");
    expect(payload).toContain("Apply to become an Alpha Guide");
  });
});
