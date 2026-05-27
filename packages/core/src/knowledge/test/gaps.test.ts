import { describe, expect, test } from "vitest";
import { buildKnowledgeGapInventory } from "../gaps.js";

describe("buildKnowledgeGapInventory", () => {
  test("groups missing answer material with representative comments and source hints", () => {
    const inventory = buildKnowledgeGapInventory([
      {
        commentId: "comment-1",
        text: "How much is tuition?",
        topic: "cost",
        classificationGroup: "informational",
        permalink: "https://instagram.com/p/1",
        likesCount: 5,
      },
      {
        commentId: "comment-2",
        text: "Do you offer scholarships?",
        topic: "cost",
        classificationGroup: "informational",
        permalink: "https://instagram.com/p/2",
        likesCount: 3,
      },
      {
        commentId: "comment-3",
        text: "How do I become a guide?",
        topic: "program",
        classificationGroup: "informational",
        permalink: "https://instagram.com/p/3",
        likesCount: 2,
      },
    ]);

    expect(inventory).toEqual([
      {
        topic: "cost",
        missingSourceType: "bio_destination_or_verified_knowledge",
        commentCount: 2,
        examples: [
          {
            commentId: "comment-1",
            text: "How much is tuition?",
            permalink: "https://instagram.com/p/1",
            likesCount: 5,
          },
          {
            commentId: "comment-2",
            text: "Do you offer scholarships?",
            permalink: "https://instagram.com/p/2",
            likesCount: 3,
          },
        ],
      },
      {
        topic: "program",
        missingSourceType: "bio_destination_or_verified_knowledge",
        commentCount: 1,
        examples: [
          {
            commentId: "comment-3",
            text: "How do I become a guide?",
            permalink: "https://instagram.com/p/3",
            likesCount: 2,
          },
        ],
      },
    ]);
  });
});
