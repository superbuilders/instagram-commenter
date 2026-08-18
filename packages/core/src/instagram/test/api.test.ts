import { afterEach, describe, expect, test, vi } from "vitest";
import {
  getCommentsWithStats,
  getRecentMediaWithStats,
} from "../api.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Instagram pagination", () => {
  test("getRecentMediaWithStats follows every media page until paging.next is exhausted", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.includes("/acct/media")) {
        return jsonResponse({
          data: [
            {
              id: "post-1",
              media_type: "VIDEO",
              permalink: "https://ig/post-1",
              timestamp: "2026-05-22T00:00:00Z",
            },
          ],
          paging: { next: "https://graph.facebook.com/page-2" },
        });
      }

      if (url === "https://graph.facebook.com/page-2") {
        return jsonResponse({
          data: [
            {
              id: "post-2",
              media_type: "IMAGE",
              permalink: "https://ig/post-2",
              timestamp: "2026-05-22T01:00:00Z",
            },
          ],
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getRecentMediaWithStats({
      accountId: "acct",
      accessToken: "token",
    });

    expect(result.posts.map((post) => post.id)).toEqual(["post-1", "post-2"]);
    expect(result.stats.pagesFetched).toBe(2);
    expect(result.stats.hitPageLimit).toBe(false);
  });

  test("getCommentsWithStats follows top-level comment pages and nested reply pages", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url === "https://graph.facebook.com/media-1/comments-page-2") {
        return jsonResponse({
          data: [
            {
              id: "comment-2",
              text: "Another parent question",
              username: "parent2",
              timestamp: "2026-05-22T00:02:00Z",
              like_count: 1,
              from: { id: "ig-user-parent2", username: "parent2" },
            },
          ],
        });
      }

      if (url === "https://graph.facebook.com/comment-1/replies-page-2") {
        return jsonResponse({
          data: [
            {
              id: "reply-2",
              text: "Second reply",
              username: "other2",
              timestamp: "2026-05-22T00:03:00Z",
              like_count: 0,
              from: { id: "ig-user-other2", username: "other2" },
            },
          ],
        });
      }

      if (url.includes("/media-1/comments")) {
        return jsonResponse({
          data: [
            {
              id: "comment-1",
              text: "Parent question",
              username: "parent",
              timestamp: "2026-05-22T00:00:00Z",
              like_count: 3,
              from: { id: "ig-user-parent", username: "parent" },
              replies: {
                data: [
                  {
                    id: "reply-1",
                    text: "First reply",
                    username: "other",
                    timestamp: "2026-05-22T00:01:00Z",
                    like_count: 0,
                    from: { id: "ig-user-other", username: "other" },
                  },
                ],
                paging: { next: "https://graph.facebook.com/comment-1/replies-page-2" },
              },
            },
          ],
          paging: { next: "https://graph.facebook.com/media-1/comments-page-2" },
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getCommentsWithStats("media-1", {
      accessToken: "token",
    });

    const firstCommentsUrl = decodeURIComponent(
      fetchMock.mock.calls
        .map(([input]) => input.toString())
        .find((url) => url.includes("/media-1/comments")) ?? ""
    );
    expect(firstCommentsUrl).toContain("from{id,username}");
    expect(firstCommentsUrl).toContain(
      "replies.limit(50){id,text,username,timestamp,like_count,from{id,username}}"
    );

    expect(result.comments.map((comment) => comment.id)).toEqual([
      "comment-1",
      "comment-2",
    ]);
    expect(result.comments[0].from?.id).toBe("ig-user-parent");
    expect(result.comments[0].replies?.data.map((reply) => reply.id)).toEqual([
      "reply-1",
      "reply-2",
    ]);
    expect(result.topLevelStats.pagesFetched).toBe(2);
    expect(result.replyStats.commentsWithReplies).toBe(1);
    expect(result.replyStats.replyPagesFetched).toBe(2);
  });

  test("getCommentsWithStats reports a page-limit hit instead of silently pretending coverage is complete", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              id: "comment-1",
              text: "Parent question",
              username: "parent",
              timestamp: "2026-05-22T00:00:00Z",
              like_count: 3,
            },
          ],
          paging: { next: "https://graph.facebook.com/next" },
        })
      )
    );

    const result = await getCommentsWithStats(
      "media-1",
      { accessToken: "token" },
      1
    );

    expect(result.comments).toHaveLength(1);
    expect(result.topLevelStats.hitPageLimit).toBe(true);
    expect(result.topLevelStats.nextUrl).toBe("https://graph.facebook.com/next");
  });
});
