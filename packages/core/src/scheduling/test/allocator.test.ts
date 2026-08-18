import { describe, expect, test } from "vitest";
import {
  allocateReplies,
  isLowValueCommunityComment,
  isLowValueNarrativeFluff,
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

  test("drops a short hot-topic cheer when a real AI objection is in the pool", () => {
    const allocated = allocateReplies(
      [
        {
          id: "cheer",
          classificationGroup: "narrative_shaping",
          likesCount: 200,
          text: "Intentional screen time 🙌💙",
          narrativeTopic: "screen_time",
        },
        {
          id: "hard-ai-question",
          classificationGroup: "narrative_shaping",
          likesCount: 2,
          text: "AI cannot replace a real teacher for kids who need human connection.",
          narrativeTopic: "ai_education",
        },
      ],
      5
    );

    expect(allocated.map((comment) => comment.id)).toEqual(["hard-ai-question"]);
    expect(allocated.some((comment) => comment.id === "cheer")).toBe(false);
  });

  test("keeps both hard questions and caps community at 20% of budget", () => {
    const community = Array.from({ length: 10 }, (_, index) => ({
      id: `community-${index}`,
      classificationGroup: "community_building" as const,
      likesCount: 40 - index,
      text: "This helped me explain 2 hour learning to my spouse and why the model works.",
    }));

    const allocated = allocateReplies(
      [
        ...community,
        {
          id: "hard-q-1",
          classificationGroup: "narrative_shaping",
          likesCount: 1,
          text: "AI cannot replace a real teacher for kids who need human connection.",
          narrativeTopic: "ai_education",
        },
        {
          id: "hard-q-2",
          classificationGroup: "informational",
          likesCount: 1,
          text: "How does 2 hour learning work for a child with an IEP?",
          infoType: "program",
        },
      ],
      5
    );

    const allocatedIds = allocated.map((comment) => comment.id);
    expect(allocatedIds).toEqual(
      expect.arrayContaining(["hard-q-1", "hard-q-2"])
    );
    expect(
      allocated.filter((comment) => comment.classificationGroup === "community_building")
    ).toHaveLength(1);
  });
});

describe("isLowValueNarrativeFluff", () => {
  test("treats a short hot-topic cheer as fluff and keeps a real argument", () => {
    expect(
      isLowValueNarrativeFluff({
        classificationGroup: "narrative_shaping",
        text: "Intentional screen time 🙌💙",
      })
    ).toBe(true);

    expect(
      isLowValueNarrativeFluff({
        classificationGroup: "narrative_shaping",
        text: "AI cannot replace a real teacher for kids who need human connection.",
      })
    ).toBe(false);
  });
});
