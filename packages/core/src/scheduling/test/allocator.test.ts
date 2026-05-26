import { describe, expect, test } from "vitest";
import {
  allocateReplies,
  isLowValueCommunityComment,
} from "../allocator.js";

describe("isLowValueCommunityComment", () => {
  test("filters emoji-only and generic praise", () => {
    expect(
      isLowValueCommunityComment({
        classificationGroup: "community_building",
        text: "👏👏👏",
      })
    ).toBe(true);

    expect(
      isLowValueCommunityComment({
        classificationGroup: "community_building",
        text: "Love this!",
      })
    ).toBe(true);
  });

  test("filters teacher giveaway entries without questions", () => {
    expect(
      isLowValueCommunityComment({
        classificationGroup: "community_building",
        text: "3rd grade math",
        postCaption: "Teacher appreciation giveaway! Teachers, comment what you teach.",
      })
    ).toBe(true);
  });

  test("keeps community comments with actual question intent", () => {
    expect(
      isLowValueCommunityComment({
        classificationGroup: "community_building",
        text: "How can my school get involved?",
      })
    ).toBe(false);
  });
});

describe("allocateReplies", () => {
  test("prioritizes narrative and informational comments over low-value community volume", () => {
    const allocated = allocateReplies(
      [
        {
          id: "emoji",
          classificationGroup: "community_building",
          likesCount: 100,
          text: "🔥🔥🔥",
        },
        {
          id: "giveaway",
          classificationGroup: "community_building",
          likesCount: 90,
          text: "kindergarten",
          postCaption: "Teacher giveaway: comment your grade or subject below.",
        },
        {
          id: "hard-ai-question",
          classificationGroup: "narrative_shaping",
          likesCount: 2,
          text: "AI cannot replace a real teacher for kids who need human connection.",
          narrativeTopic: "ai_education",
        },
        {
          id: "location-question",
          classificationGroup: "informational",
          likesCount: 0,
          text: "Are you opening in Chicago?",
          infoType: "location",
        },
        {
          id: "useful-community",
          classificationGroup: "community_building",
          likesCount: 1,
          text: "This helped me explain 2 hour learning to my spouse.",
        },
      ],
      5
    );

    expect(allocated.map((comment) => comment.id)).toEqual([
      "hard-ai-question",
      "location-question",
      "useful-community",
    ]);
    expect(allocated[0].allocationScore).toBeGreaterThan(
      allocated[1].allocationScore
    );
  });
});
