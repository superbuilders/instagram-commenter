const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

export interface InstagramApiOptions {
  accessToken: string;
  accountId: string;
}

export interface IGPost {
  id: string;
  caption?: string;
  media_type: string;
  permalink: string;
  timestamp: string;
  comments_count?: number;
}

export interface IGComment {
  id: string;
  text: string;
  username: string;
  timestamp: string;
  like_count: number;
  replies?: { data: IGComment[] };
}

interface GraphResponse<T> {
  data: T[];
  paging?: {
    cursors?: { before: string; after: string };
    next?: string;
  };
}

interface GraphError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
  };
}

export interface RateLimitInfo {
  callCount: number;
  totalCpuTime: number;
  totalTime: number;
}

async function graphFetch<T>(
  path: string,
  params: Record<string, string>,
  accessToken: string,
  retries = 2
): Promise<T> {
  const url = new URL(`${GRAPH_API_BASE}${path}`);
  url.searchParams.set("access_token", accessToken);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url.toString());

    if (response.status === 429) {
      if (attempt < retries) {
        const waitMs = Math.pow(2, attempt + 1) * 1000;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw new Error("Instagram API rate limit exceeded after retries");
    }

    if (!response.ok) {
      const err = (await response.json()) as GraphError;
      throw new Error(
        `Instagram API error ${response.status}: ${err.error?.message ?? "Unknown"} (code ${err.error?.code})`
      );
    }

    return response.json() as Promise<T>;
  }

  throw new Error("Unreachable");
}

export async function getRecentMedia(
  opts: InstagramApiOptions
): Promise<IGPost[]> {
  const result = await graphFetch<GraphResponse<IGPost>>(
    `/${opts.accountId}/media`,
    {
      fields: "id,caption,media_type,permalink,timestamp,comments_count",
      limit: "25",
    },
    opts.accessToken
  );
  return result.data;
}

export async function getComments(
  mediaId: string,
  opts: Pick<InstagramApiOptions, "accessToken">,
  maxPages = 5
): Promise<IGComment[]> {
  const all: IGComment[] = [];
  let nextUrl: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    let result: GraphResponse<IGComment>;

    if (nextUrl) {
      const response = await fetch(nextUrl);
      if (!response.ok) break;
      result = (await response.json()) as GraphResponse<IGComment>;
    } else {
      result = await graphFetch<GraphResponse<IGComment>>(
        `/${mediaId}/comments`,
        {
          fields:
            "id,text,username,timestamp,like_count,replies{id,text,username,timestamp,like_count}",
          limit: "50",
        },
        opts.accessToken
      );
    }

    all.push(...result.data);
    nextUrl = result.paging?.next;
    if (!nextUrl) break;
  }

  return all;
}

export async function postReply(
  commentId: string,
  message: string,
  opts: Pick<InstagramApiOptions, "accessToken">
): Promise<string> {
  const url = new URL(`${GRAPH_API_BASE}/${commentId}/replies`);
  url.searchParams.set("access_token", opts.accessToken);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    const err = (await response.json()) as GraphError;
    throw new Error(
      `Failed to post reply: ${err.error?.message ?? response.status}`
    );
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}

export async function deleteComment(
  commentId: string,
  opts: Pick<InstagramApiOptions, "accessToken">
): Promise<void> {
  const url = new URL(`${GRAPH_API_BASE}/${commentId}`);
  url.searchParams.set("access_token", opts.accessToken);

  const response = await fetch(url.toString(), { method: "DELETE" });

  if (!response.ok) {
    const err = (await response.json()) as GraphError;
    throw new Error(
      `Failed to delete comment: ${err.error?.message ?? response.status}`
    );
  }
}

export async function refreshLongLivedToken(
  currentToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const result = await graphFetch<{
    access_token: string;
    token_type: string;
    expires_in: number;
  }>(
    "/refresh_access_token",
    {
      grant_type: "ig_refresh_token",
      access_token: currentToken,
    },
    currentToken,
    0
  );

  return { access_token: result.access_token, expires_in: result.expires_in };
}

export function parseRateLimitHeader(
  headerValue: string | null
): RateLimitInfo | null {
  if (!headerValue) return null;
  try {
    const parsed = JSON.parse(headerValue);
    const key = Object.keys(parsed)[0];
    if (!key) return null;
    const info = parsed[key][0];
    return {
      callCount: info.call_count ?? 0,
      totalCpuTime: info.total_cputime ?? 0,
      totalTime: info.total_time ?? 0,
    };
  } catch {
    return null;
  }
}
