import { afterEach, describe, expect, test, vi } from "vitest";
import { discoverBusinessProfile } from "../business-discovery.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("discoverBusinessProfile", () => {
  test("requests official Graph v21.0 business_discovery.username fields", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = decodeURIComponent(input.toString());
      expect(url).toContain("https://graph.facebook.com/v21.0/ig-user-1");
      expect(url).toContain("business_discovery.username(alpha.parent)");
      expect(url).toContain(
        "{id,username,name,biography,website,followers_count,media_count,profile_picture_url}"
      );
      return jsonResponse({
        business_discovery: {
          id: "igb-1",
          username: "alpha.parent",
          name: "Alpha Parent",
          followers_count: 1200,
          media_count: 40,
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await discoverBusinessProfile("@alpha.parent!", {
      accessToken: "token",
      igUserId: "ig-user-1",
    });

    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.profile.id).toBe("igb-1");
    }
  });

  test("maps 400 Invalid user id to not_discoverable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              message: "Invalid user id",
              type: "OAuthException",
              code: 110,
            },
          },
          400
        )
      )
    );

    const result = await discoverBusinessProfile("private.user", {
      accessToken: "token",
      igUserId: "ig-user-1",
    });

    expect(result.status).toBe("not_discoverable");
  });
});
