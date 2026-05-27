import { describe, expect, test } from "vitest";
import { buildUserMessage } from "../generator.js";

describe("buildUserMessage", () => {
  test("includes rejected examples as avoidance guidance", () => {
    const message = buildUserMessage({
      commentText: "👏👏👏",
      postCaption: "A day at Alpha.",
      classificationGroup: "community_building",
      knowledge: [],
      examples: [],
      negativeExamples: [
        {
          id: "negative-1",
          commentText: "🔥🔥🔥",
          responseText: "So glad this resonated!",
          isPositive: false,
          source: "slack_rejected",
          classificationGroup: "community_building",
          reviewReason: "should_not_reply",
          reviewNotes: "Generic emoji response. Do not reply.",
          similarity: 0.86,
        },
      ],
    });

    expect(message).toContain("SIMILAR REJECTED REPLIES");
    expect(message).toContain("Rejected draft");
    expect(message).toContain("should not reply");
    expect(message).toContain("Generic emoji response");
  });

  test("includes Bio Destination evidence as retrieved knowledge", () => {
    const message = buildUserMessage({
      commentText: "How do I become a teacher at Alpha?",
      postCaption: "Our guides are incredible.",
      classificationGroup: "informational",
      infoType: "program",
      knowledge: [
        {
          id: "bio-1",
          title: "Become a Guide",
          content: "Apply to become an Alpha Guide. Guides support motivation and life skills.",
          sourceType: "bio_destination",
          brainliftType: "institutional",
          sourceWeight: 1.2,
          narrativeTopics: [],
          sourceUrl: "https://alpha.school/guides",
          similarity: 0.67,
        },
      ],
      examples: [],
    });

    expect(message).toContain("RETRIEVED KNOWLEDGE");
    expect(message).toContain("🔒 VERIFIED [institutional]");
    expect(message).toContain("Become a Guide");
    expect(message).toContain("Apply to become an Alpha Guide");
  });
});
