import { describe, expect, test } from "vitest";
import {
  createApifyPostContextClient,
  normalizeApifyPostContextResult,
} from "../apify.js";

describe("normalizeApifyPostContextResult", () => {
  test("normalizes common transcript and metadata fields from Apify items", () => {
    const result = normalizeApifyPostContextResult("https://instagram.com/reel/x", [
      {
        transcript: "A reel transcript",
        duration: "33",
        displayUrl: "https://cdn.example/thumb.jpg",
        url: "https://instagram.com/reel/x",
      },
    ]);

    expect(result).toMatchObject({
      transcript: "A reel transcript",
      durationSeconds: 33,
      thumbnailUrl: "https://cdn.example/thumb.jpg",
      sourceUrl: "https://instagram.com/reel/x",
    });
  });
});

describe("createApifyPostContextClient", () => {
  test("fails clearly when the Apify token is missing", async () => {
    const client = createApifyPostContextClient({ token: "" });

    await expect(
      client.fetchPostContext({ postUrl: "https://instagram.com/reel/x" })
    ).rejects.toThrow("Apify token is missing");
  });
});
