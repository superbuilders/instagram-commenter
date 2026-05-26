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
});
