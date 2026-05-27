import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { buildUserMessage } from "../../ai/generator.js";
import {
  postContextToSearchResult,
  rankBioDestinationSnapshots,
} from "../../knowledge/search.js";
import { buildApprovalMessage } from "../../slack/blocks.js";

interface ContextGroundingEvalCase {
  id: string;
  category: "bio_destination" | "post_context" | "provenance";
  comment: string;
  expectedEvidence: string;
  mustMention: string;
  mustAvoid: string;
}

describe("context grounding eval cases", () => {
  function loadCases(): ContextGroundingEvalCase[] {
    const file = path.resolve(
      process.cwd(),
      "data/context-grounding-eval-cases.json"
    );
    return JSON.parse(fs.readFileSync(file, "utf-8")) as ContextGroundingEvalCase[];
  }

  test("define the local failure modes this grounding layer protects against", () => {
    const cases = loadCases();

    expect(cases.length).toBeGreaterThanOrEqual(4);
    expect(new Set(cases.map((c) => c.category))).toEqual(
      new Set(["bio_destination", "post_context", "provenance"])
    );

    for (const evalCase of cases) {
      expect(evalCase.id).toMatch(/^[a-z0-9-]+$/);
      expect(evalCase.comment.length).toBeGreaterThan(5);
      expect(evalCase.expectedEvidence.length).toBeGreaterThan(0);
      expect(evalCase.mustMention.length).toBeGreaterThan(0);
      expect(evalCase.mustAvoid.length).toBeGreaterThan(0);
    }
  });

  test("grounds teacher/Guide questions in a specific Bio Destination Snapshot", () => {
    const evalCase = loadCases().find((c) => c.id === "bio-guide-application");
    expect(evalCase).toBeDefined();

    const [match] = rankBioDestinationSnapshots(evalCase!.comment, [
      {
        destinationId: "guide-destination",
        title: "Become a Guide",
        url: "https://alpha.school/guides",
        visibleText:
          "Apply to become an Alpha Guide. Guides support students with motivation and life skills.",
      },
      {
        destinationId: "alpha-anywhere",
        title: "Alpha Anywhere",
        url: "https://alpha.school/anywhere",
        visibleText: "A virtual school option for families.",
      },
    ]);

    expect(match).toMatchObject({
      sourceType: evalCase!.expectedEvidence,
      title: evalCase!.mustMention,
      sourceUrl: "https://alpha.school/guides",
    });

    const prompt = buildUserMessage({
      commentText: evalCase!.comment,
      postCaption: "Our guides are incredible.",
      classificationGroup: "informational",
      infoType: "program",
      knowledge: [match],
      examples: [],
    });

    expect(prompt).toContain("🔒 VERIFIED [institutional] Become a Guide");
    expect(prompt).toContain("https://alpha.school/guides");
  });

  test("does not manufacture a Bio Destination when the inventory has no match", () => {
    const evalCase = loadCases().find((c) => c.id === "bio-no-matching-destination");
    expect(evalCase).toBeDefined();

    const matches = rankBioDestinationSnapshots(evalCase!.comment, [
      {
        destinationId: "guide-destination",
        title: "Become a Guide",
        url: "https://alpha.school/guides",
        visibleText: "Apply to become an Alpha Guide.",
      },
      {
        destinationId: "city-destination",
        title: "Bring Alpha to Your City",
        url: "https://alpha.school/cities",
        visibleText: "Nominate your city for a future Alpha campus.",
      },
    ]).filter((result) => result.similarity >= 0.3);

    expect(matches).toEqual([]);
  });

  test("represents current video transcript as Post Context evidence", () => {
    const evalCase = loadCases().find((c) => c.id === "post-context-test2pass");
    expect(evalCase).toBeDefined();

    const result = postContextToSearchResult({
      id: "post-context-1",
      postId: "post-1",
      transcript:
        "Current post transcript: students do not farm fails. Test2Pass means they retry until they demonstrate real mastery.",
      durationSeconds: 58,
      thumbnailUrl: "https://cdn.example/thumb.jpg",
      sourceUrl: "https://instagram.com/reel/current",
      metadata: null,
      createdAt: new Date("2026-05-26T20:00:00.000Z"),
      updatedAt: new Date("2026-05-26T20:00:00.000Z"),
    });

    expect(result).toMatchObject({
      sourceType: evalCase!.expectedEvidence,
      sourceUrl: "https://instagram.com/reel/current",
      similarity: 1,
    });
    expect(result?.title?.toLowerCase()).toBe(evalCase!.mustMention);
    expect(result?.content).toContain("Test2Pass");
  });

  test("shows provenance on the Slack Review Card", () => {
    const evalCase = loadCases().find((c) => c.id === "provenance-visible");
    expect(evalCase).toBeDefined();

    const message = buildApprovalMessage(
      {
        id: "comment-1",
        text: evalCase!.comment,
        authorUsername: "parent",
        likesCount: 0,
        postCaption: "$100K starting salary for our Guides",
        postPermalink: "https://instagram.com/p/example",
      },
      {
        id: "reply-1",
        text: "Campus tuition starts as low as $10,000 where available. DM us and we can help with specifics.",
        classificationGroup: "informational",
        confidence: 0.93,
        evidenceSources: [
          {
            sourceType: "bio_destination",
            title: "Alpha Tuition",
            url: "https://alpha.school/tuition",
            snippet: "Tuition information for Alpha campuses and programs.",
            similarity: 0.62,
          },
        ],
      },
      "$100K starting salary for our Guides"
    );

    const payload = JSON.stringify(message.blocks);

    expect(payload).toContain(evalCase!.mustMention);
    expect(payload).toContain("Alpha Tuition");
    expect(payload).toContain("https://alpha.school/tuition");
  });
});
