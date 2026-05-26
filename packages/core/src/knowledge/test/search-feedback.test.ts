import { describe, expect, test } from "vitest";
import {
  findLearnedSkipMatch,
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
