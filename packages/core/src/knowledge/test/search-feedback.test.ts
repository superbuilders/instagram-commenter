import { describe, expect, test } from "vitest";
import {
  findLearnedSkipMatch,
  rankBioDestinationSnapshots,
  postContextToSearchResult,
  type ExampleResult,
} from "../search.js";

function example(overrides: Partial<ExampleResult>): ExampleResult {
  return {
    id: "example-1",
    commentText: "👏👏👏",
    responseText: "So glad this resonated!",
    isPositive: false,
    source: "slack_rejected",
    classificationGroup: "community_building",
    reviewReason: "should_not_reply",
    reviewNotes: "Emoji-only comment. Do not spend review budget here.",
    similarity: 0.82,
    ...overrides,
  };
}

describe("findLearnedSkipMatch", () => {
  test("returns high-similarity should_not_reply feedback", () => {
    const match = findLearnedSkipMatch([example({})]);

    expect(match?.id).toBe("example-1");
  });

  test("does not hard-skip softer rejection reasons", () => {
    const match = findLearnedSkipMatch([
      example({ reviewReason: "off_brand_voice", similarity: 0.95 }),
    ]);

    expect(match).toBeNull();
  });

  test("does not hard-skip weak similarity matches", () => {
    const match = findLearnedSkipMatch([
      example({ reviewReason: "should_not_reply", similarity: 0.77 }),
    ]);

    expect(match).toBeNull();
  });
});

describe("postContextToSearchResult", () => {
  test("turns a current post transcript into verified Post Context evidence", () => {
    const result = postContextToSearchResult({
      id: "context-1",
      postId: "post-1",
      transcript: "Test2Pass means students demonstrate mastery before moving on.",
      durationSeconds: 42,
      thumbnailUrl: "https://cdn.example/thumb.jpg",
      sourceUrl: "https://instagram.com/reel/example",
      metadata: null,
      createdAt: new Date("2026-05-26T16:00:00.000Z"),
      updatedAt: new Date("2026-05-26T16:00:00.000Z"),
    });

    expect(result).toMatchObject({
      id: "context-1",
      title: "Current post transcript",
      sourceType: "post_context",
      brainliftType: "institutional",
      content: "Test2Pass means students demonstrate mastery before moving on.",
      sourceUrl: "https://instagram.com/reel/example",
      similarity: 1,
    });
  });
});

describe("rankBioDestinationSnapshots", () => {
  test("matches guide hiring questions to a Become a Guide Bio Destination Snapshot", () => {
    const matches = rankBioDestinationSnapshots("How do I become a teacher at Alpha?", [
      {
        destinationId: "destination-1",
        title: "Become a Guide",
        url: "https://alpha.school/guides",
        visibleText: "Apply to become an Alpha Guide. Guides support students with motivation and life skills.",
      },
      {
        destinationId: "destination-2",
        title: "Alpha Anywhere",
        url: "https://alpha.school/anywhere",
        visibleText: "Alpha Anywhere is a virtual school option for families.",
      },
    ]);

    expect(matches[0]).toMatchObject({
      title: "Become a Guide",
      sourceType: "bio_destination",
      sourceUrl: "https://alpha.school/guides",
    });
    expect(matches[0].similarity).toBeGreaterThan(0.3);
  });
});
