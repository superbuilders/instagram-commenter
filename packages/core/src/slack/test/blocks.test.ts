import { describe, expect, test } from "vitest";
import {
  buildApprovalMessage,
  buildDigestMessage,
  buildKnowledgeGapMessage,
  buildRelationshipCard,
} from "../blocks.js";

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

describe("buildKnowledgeGapMessage", () => {
  test("is info-only and never includes approve actions or SlackChannelId", () => {
    const message = buildKnowledgeGapMessage({
      date: "2026-08-17",
      timeZone: "America/Chicago",
      topics: [{ topic: "location", commentCount: 3, eventCount: 4 }],
      examples: [
        {
          topic: "location",
          infoType: "location",
          authorUsername: "parent",
          likesCount: 6,
          text: "Please bring Alpha to Austin.",
          permalink: "https://instagram.com/p/example",
          skipReason: null,
        },
      ],
    });

    const payload = JSON.stringify(message);

    expect(payload).toContain("Knowledge gaps — 2026-08-17");
    expect(payload).toContain("infoType location");
    expect(payload).toContain("@parent");
    expect(payload).toContain("6 likes");
    expect(payload).toContain("Please bring Alpha to Austin.");
    expect(payload).not.toMatch(/"action_id"/);
    expect(payload).not.toMatch(/"action_id"\s*:\s*"(approve|edit|reject)"/);
    expect(payload).not.toContain("SlackChannelId");
  });
});

describe("buildDigestMessage", () => {
  test("does not render knowledge gaps on the #foe-bot digest", () => {
    const message = buildDigestMessage({
      date: "2026-08-17",
      timeZone: "America/Chicago",
      totalComments: 10,
      classifications: { informational: 2 },
      repliesPosted: 1,
      repliesApproved: 1,
      repliesEdited: 0,
      repliesRejected: 0,
      repliesAuto: 0,
      deletionsExecuted: 0,
      budgetUtilization: 0.1,
    });

    const payload = JSON.stringify(message);
    expect(payload).not.toContain("Knowledge gaps");
    expect(payload).not.toContain("SlackChannelId");
  });
});

describe("buildRelationshipCard", () => {
  test("is info-only with no DM, Approve, action_id, or SlackChannelId", () => {
    const message = buildRelationshipCard(
      {
        username: "curious.parent",
        name: "Curious Parent",
        biography: "Education nerd in Texas.",
        website: "https://example.com",
        followersCount: 2400,
        mediaCount: 88,
      },
      {
        text: "How do you keep kids human when AI is doing the academics?",
        authorUsername: "curious.parent",
        likesCount: 11,
        postPermalink: "https://instagram.com/p/example",
        postCaption: "Why guides still matter.",
      }
    );

    const payload = JSON.stringify(message);
    const footer = JSON.stringify(message.blocks[message.blocks.length - 1]);

    expect(payload).toContain("@curious.parent");
    expect(payload).toContain("Info only. No messaging or reply actions.");
    expect(footer).not.toMatch(/DM/);
    expect(payload).not.toContain("Approve");
    expect(payload).not.toMatch(/"action_id"/);
    expect(payload).not.toContain("SlackChannelId");
  });
});
