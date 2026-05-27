import { describe, expect, test } from "vitest";
import {
  createMemoryPostContextStore,
  runPostContextJobForPost,
  type ApifyPostContextClient,
} from "../jobs.js";

describe("runPostContextJobForPost", () => {
  test("creates a Post Context Job and stores transcript metadata for a video post", async () => {
    const store = createMemoryPostContextStore();
    const client: ApifyPostContextClient = {
      async fetchPostContext(input) {
        expect(input.postUrl).toBe("https://www.instagram.com/reel/example/");
        return {
          runId: "run-1",
          datasetId: "dataset-1",
          transcript: "Students demonstrate mastery before moving on.",
          durationSeconds: 42,
          thumbnailUrl: "https://cdn.example/thumb.jpg",
          sourceUrl: input.postUrl,
          metadata: { views: 1000 },
        };
      },
    };

    const result = await runPostContextJobForPost(
      {
        postId: "post-1",
        mediaType: "VIDEO",
        permalink: "https://www.instagram.com/reel/example/",
        caption: "Mastery matters.",
      },
      { store, client, now: new Date("2026-05-26T16:00:00.000Z") }
    );

    expect(result.status).toBe("ready");
    expect(result.context?.transcript).toBe(
      "Students demonstrate mastery before moving on."
    );

    const job = await store.getJobForPost("post-1");
    expect(job).toMatchObject({
      postId: "post-1",
      status: "ready",
      apifyRunId: "run-1",
      apifyDatasetId: "dataset-1",
    });

    const context = await store.getContextForPost("post-1");
    expect(context).toMatchObject({
      postId: "post-1",
      transcript: "Students demonstrate mastery before moving on.",
      durationSeconds: 42,
      thumbnailUrl: "https://cdn.example/thumb.jpg",
    });
  });

  test("reuses an existing ready Post Context without calling Apify again", async () => {
    const store = createMemoryPostContextStore();
    let calls = 0;
    const client: ApifyPostContextClient = {
      async fetchPostContext() {
        calls++;
        return {
          runId: "run-1",
          datasetId: "dataset-1",
          transcript: "Existing transcript.",
          durationSeconds: 12,
          thumbnailUrl: null,
          sourceUrl: "https://www.instagram.com/reel/example/",
        };
      },
    };
    const post = {
      postId: "post-1",
      mediaType: "VIDEO",
      permalink: "https://www.instagram.com/reel/example/",
      caption: null,
    };

    await runPostContextJobForPost(post, { store, client });
    await runPostContextJobForPost(post, { store, client });

    expect(calls).toBe(1);
    expect((await store.getJobForPost("post-1"))?.status).toBe("ready");
  });

  test("marks the Post Context Job failed when Apify cannot return context", async () => {
    const store = createMemoryPostContextStore();
    const client: ApifyPostContextClient = {
      async fetchPostContext() {
        throw new Error("Apify token is missing");
      },
    };

    const result = await runPostContextJobForPost(
      {
        postId: "post-1",
        mediaType: "VIDEO",
        permalink: "https://www.instagram.com/reel/example/",
        caption: null,
      },
      { store, client, now: new Date("2026-05-26T16:00:00.000Z") }
    );

    expect(result.status).toBe("failed");
    expect(result.job).toMatchObject({
      status: "failed",
      failureReason: "Apify token is missing",
    });
    expect(await store.getContextForPost("post-1")).toBeUndefined();
  });
});
