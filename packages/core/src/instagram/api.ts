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
  from?: { id: string; username?: string };
  replies?: GraphResponse<IGComment>;
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

export interface PagedFetchStats {
  pagesFetched: number;
  hitPageLimit: boolean;
  nextUrl: string | null;
}

export interface MediaFetchResult {
  posts: IGPost[];
  stats: PagedFetchStats;
}

export interface CommentFetchResult {
  comments: IGComment[];
  topLevelStats: PagedFetchStats;
  replyStats: {
    commentsWithReplies: number;
    replyPagesFetched: number;
    hitReplyPageLimit: boolean;
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

async function graphFetchUrl<T>(
  url: string,
  retries = 2
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url);

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

async function collectPaged<T>(
  firstPage: () => Promise<GraphResponse<T>>,
  maxPages: number
): Promise<{ items: T[]; stats: PagedFetchStats }> {
  const items: T[] = [];
  let nextUrl: string | undefined;
  let pagesFetched = 0;

  while (pagesFetched < maxPages) {
    const result = nextUrl
      ? await graphFetchUrl<GraphResponse<T>>(nextUrl)
      : await firstPage();

    pagesFetched++;
    items.push(...result.data);
    nextUrl = result.paging?.next;
    if (!nextUrl) break;
  }

  return {
    items,
    stats: {
      pagesFetched,
      hitPageLimit: Boolean(nextUrl),
      nextUrl: nextUrl ?? null,
    },
  };
}

function dedupeComments(comments: IGComment[]): IGComment[] {
  const seen = new Set<string>();
  const deduped: IGComment[] = [];

  for (const comment of comments) {
    if (seen.has(comment.id)) continue;
    seen.add(comment.id);
    deduped.push(comment);
  }

  return deduped;
}

async function fetchRemainingReplies(
  comment: IGComment,
  maxReplyPages: number
): Promise<{ comment: IGComment; pagesFetched: number; hitPageLimit: boolean }> {
  const replies = [...(comment.replies?.data ?? [])];
  let nextUrl = comment.replies?.paging?.next;
  let pagesFetched = replies.length > 0 ? 1 : 0;

  while (nextUrl && pagesFetched < maxReplyPages) {
    const result = await graphFetchUrl<GraphResponse<IGComment>>(nextUrl);
    pagesFetched++;
    replies.push(...result.data);
    nextUrl = result.paging?.next;
  }

  return {
    comment: {
      ...comment,
      replies: replies.length > 0 ? { data: dedupeComments(replies) } : undefined,
    },
    pagesFetched,
    hitPageLimit: Boolean(nextUrl),
  };
}

export async function getRecentMediaWithStats(
  opts: InstagramApiOptions,
  maxPages = Number.POSITIVE_INFINITY
): Promise<MediaFetchResult> {
  const result = await collectPaged(
    () =>
      graphFetch<GraphResponse<IGPost>>(
        `/${opts.accountId}/media`,
        {
          fields: "id,caption,media_type,permalink,timestamp,comments_count",
          limit: "25",
        },
        opts.accessToken
      ),
    maxPages
  );

  return { posts: result.items, stats: result.stats };
}

export async function getRecentMedia(
  opts: InstagramApiOptions,
  maxPages = Number.POSITIVE_INFINITY
): Promise<IGPost[]> {
  const result = await getRecentMediaWithStats(opts, maxPages);
  return result.posts;
}

export async function getCommentsWithStats(
  mediaId: string,
  opts: Pick<InstagramApiOptions, "accessToken">,
  maxPages = Number.POSITIVE_INFINITY,
  maxReplyPages = Number.POSITIVE_INFINITY
): Promise<CommentFetchResult> {
  const result = await collectPaged(
    () =>
      graphFetch<GraphResponse<IGComment>>(
        `/${mediaId}/comments`,
        {
          fields:
            "id,text,username,timestamp,like_count,from{id,username},replies.limit(50){id,text,username,timestamp,like_count,from{id,username}}",
          limit: "50",
        },
        opts.accessToken
      ),
    maxPages
  );

  const comments: IGComment[] = [];
  let commentsWithReplies = 0;
  let replyPagesFetched = 0;
  let hitReplyPageLimit = false;

  for (const comment of result.items) {
    const replyResult = await fetchRemainingReplies(
      comment,
      maxReplyPages
    );
    if (replyResult.pagesFetched > 0) commentsWithReplies++;
    replyPagesFetched += replyResult.pagesFetched;
    hitReplyPageLimit ||= replyResult.hitPageLimit;
    comments.push(replyResult.comment);
  }

  return {
    comments: dedupeComments(comments),
    topLevelStats: result.stats,
    replyStats: {
      commentsWithReplies,
      replyPagesFetched,
      hitReplyPageLimit,
    },
  };
}

export async function getComments(
  mediaId: string,
  opts: Pick<InstagramApiOptions, "accessToken">,
  maxPages = Number.POSITIVE_INFINITY
): Promise<IGComment[]> {
  const result = await getCommentsWithStats(mediaId, opts, maxPages);
  return result.comments;
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
