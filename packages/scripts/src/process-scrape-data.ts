import * as fs from "fs";
import * as path from "path";
import type {
  ApifyPostResult,
  ApifyCommentResult,
  ProcessedReplyPair,
  ProcessedCaption,
  PoolComment,
  VoiceAnalytics,
  ScrapeSummary,
} from "./apify-types.js";

const ACCOUNT = "futureof_education";
const RAW_DIR = path.resolve(import.meta.dirname, "../../../data/apify-raw");
const OUT_DIR = path.resolve(import.meta.dirname, "../../../data/voice-samples");

function isAccount(username: string | undefined): boolean {
  return !!username && username.toLowerCase() === ACCOUNT.toLowerCase();
}

function loadJSON<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function buildPostMap(posts: ApifyPostResult[]): Map<string, ApifyPostResult> {
  const map = new Map<string, ApifyPostResult>();
  for (const post of posts) {
    if (post.url) map.set(post.url, post);
    if (post.shortCode) map.set(post.shortCode, post);
  }
  return map;
}

function findPostForComment(
  comment: ApifyCommentResult,
  postMap: Map<string, ApifyPostResult>
): ApifyPostResult | undefined {
  if (comment.postUrl) {
    const post = postMap.get(comment.postUrl);
    if (post) return post;
  }
  if (comment.postShortCode) {
    return postMap.get(comment.postShortCode);
  }
  return undefined;
}

function extractReplyPairs(
  comments: ApifyCommentResult[],
  postMap: Map<string, ApifyPostResult>
): ProcessedReplyPair[] {
  const pairs: ProcessedReplyPair[] = [];
  const seen = new Set<string>();

  for (const comment of comments) {
    if (!comment.replies?.length) continue;

    const post = findPostForComment(comment, postMap);

    for (const reply of comment.replies) {
      if (!isAccount(reply.ownerUsername)) continue;
      const key = `${comment.id}-${reply.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      pairs.push({
        parentComment: {
          username: comment.ownerUsername,
          text: comment.text,
          timestamp: comment.timestamp,
          likesCount: comment.likesCount ?? 0,
        },
        mackenzieReply: {
          text: reply.text,
          timestamp: reply.timestamp,
          likesCount: reply.likesCount ?? 0,
        },
        postContext: {
          caption: post?.caption ?? "",
          permalink: post?.url ?? "",
          postTimestamp: post?.timestamp ?? "",
          hashtags: post?.hashtags ?? [],
          mediaType: post?.type ?? "",
        },
      });
    }
  }

  return pairs;
}

function extractAllCommentsPool(
  comments: ApifyCommentResult[],
  postMap: Map<string, ApifyPostResult>,
  repliedCommentIds: Set<string>
): PoolComment[] {
  const pool: PoolComment[] = [];
  const seen = new Set<string>();

  for (const comment of comments) {
    if (!comment.id || !comment.text) continue;
    if (seen.has(comment.id)) continue;
    if (isAccount(comment.ownerUsername)) continue;
    seen.add(comment.id);

    const post = findPostForComment(comment, postMap);

    pool.push({
      id: comment.id,
      text: comment.text,
      username: comment.ownerUsername,
      timestamp: comment.timestamp,
      likesCount: comment.likesCount ?? 0,
      postCaption: post?.caption ?? "",
      postPermalink: post?.url ?? "",
      mackenzieReplied: repliedCommentIds.has(comment.id),
    });
  }

  return pool;
}

function extractCaptions(posts: ApifyPostResult[]): ProcessedCaption[] {
  return posts
    .filter((p) => p.caption?.trim())
    .map((p) => ({
      caption: p.caption,
      permalink: p.url,
      timestamp: p.timestamp,
      mediaType: p.type,
      hashtags: p.hashtags ?? [],
      mentions: p.mentions ?? [],
      likesCount: p.likesCount ?? 0,
      commentsCount: p.commentsCount ?? 0,
    }));
}

function extractNgrams(text: string, n: number): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s']/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const ngrams: string[] = [];
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.push(words.slice(i, i + n).join(" "));
  }
  return ngrams;
}

function extractEmojis(text: string): string[] {
  const emojiRegex =
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]/gu;
  return text.match(emojiRegex) ?? [];
}

function computeVoiceAnalytics(pairs: ProcessedReplyPair[]): VoiceAnalytics {
  const replyTexts = pairs.map((p) => p.mackenzieReply.text);
  const lengths = replyTexts.map((t) => t.length).sort((a, b) => a - b);

  const min = lengths[0] ?? 0;
  const max = lengths[lengths.length - 1] ?? 0;
  const avg = lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0;
  const median = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0;

  const buckets: Record<string, number> = {
    "0-50": 0,
    "51-100": 0,
    "101-200": 0,
    "201-300": 0,
    "301-500": 0,
    "500+": 0,
  };
  for (const len of lengths) {
    if (len <= 50) buckets["0-50"]++;
    else if (len <= 100) buckets["51-100"]++;
    else if (len <= 200) buckets["101-200"]++;
    else if (len <= 300) buckets["201-300"]++;
    else if (len <= 500) buckets["301-500"]++;
    else buckets["500+"]++;
  }

  const phraseCounts = new Map<string, number>();
  for (const text of replyTexts) {
    for (const n of [2, 3, 4]) {
      for (const ngram of extractNgrams(text, n)) {
        phraseCounts.set(ngram, (phraseCounts.get(ngram) || 0) + 1);
      }
    }
  }
  const commonPhrases = [...phraseCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([phrase, count]) => ({ phrase, count }));

  const emojiCounts: Record<string, number> = {};
  for (const text of replyTexts) {
    for (const emoji of extractEmojis(text)) {
      emojiCounts[emoji] = (emojiCounts[emoji] || 0) + 1;
    }
  }

  const responseTimeMinutes: number[] = [];
  for (const pair of pairs) {
    const commentTime = new Date(pair.parentComment.timestamp).getTime();
    const replyTime = new Date(pair.mackenzieReply.timestamp).getTime();
    if (commentTime && replyTime && replyTime > commentTime) {
      responseTimeMinutes.push(Math.round((replyTime - commentTime) / 60000));
    }
  }

  const questionPairs = pairs.filter((p) => p.parentComment.text.includes("?"));
  const nonQuestionPairs = pairs.filter((p) => !p.parentComment.text.includes("?"));
  const avgLen = (ps: ProcessedReplyPair[]) =>
    ps.length ? Math.round(ps.reduce((s, p) => s + p.mackenzieReply.text.length, 0) / ps.length) : 0;

  return {
    replyLengths: { min, max, avg, median, distribution: buckets },
    commonPhrases,
    emojiUsage: emojiCounts,
    responseTimeMinutes,
    avgReplyLengthByCommentType: {
      questions: avgLen(questionPairs),
      nonQuestions: avgLen(nonQuestionPairs),
    },
  };
}

function computeSummary(
  posts: ApifyPostResult[],
  comments: ApifyCommentResult[],
  pairs: ProcessedReplyPair[]
): ScrapeSummary {
  const nonOwnerComments = comments.filter((c) => !isAccount(c.ownerUsername));
  const totalComments = nonOwnerComments.length;

  const timestamps = posts.map((p) => p.timestamp).filter(Boolean).sort();

  const commenterReplyCounts = new Map<string, number>();
  for (const pair of pairs) {
    const u = pair.parentComment.username;
    commenterReplyCounts.set(u, (commenterReplyCounts.get(u) || 0) + 1);
  }
  const topEngaged = [...commenterReplyCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([username, replyCount]) => ({ username, replyCount }));

  return {
    totalPosts: posts.length,
    totalComments,
    totalReplyPairs: pairs.length,
    replyRate: totalComments > 0 ? Math.round((pairs.length / totalComments) * 100) / 100 : 0,
    dateRange: {
      earliest: timestamps[0] ?? "",
      latest: timestamps[timestamps.length - 1] ?? "",
    },
    avgRepliesPerPost:
      posts.length > 0 ? Math.round((pairs.length / posts.length) * 100) / 100 : 0,
    topEngagedCommenters: topEngaged,
  };
}

function extractCommentsFromPosts(posts: ApifyPostResult[]): ApifyCommentResult[] {
  const comments: ApifyCommentResult[] = [];
  for (const post of posts) {
    const latestComments = (post as any).latestComments as ApifyCommentResult[] | undefined;
    if (!latestComments?.length) continue;
    for (const comment of latestComments) {
      comments.push({
        ...comment,
        postUrl: post.url,
        postShortCode: post.shortCode,
      });
    }
  }
  return comments;
}

function main() {
  const postsFile = path.join(RAW_DIR, "posts-raw.json");
  const commentsFile = path.join(RAW_DIR, "comments-raw.json");

  if (!fs.existsSync(postsFile)) {
    console.error(`Posts file not found: ${postsFile}\nRun 'npm run scrape' first.`);
    process.exit(1);
  }

  const posts = loadJSON<ApifyPostResult[]>(postsFile);

  let comments: ApifyCommentResult[];
  if (fs.existsSync(commentsFile)) {
    comments = loadJSON<ApifyCommentResult[]>(commentsFile);
    console.log(`Loaded ${comments.length} comments from comments-raw.json`);
  } else {
    console.log("No comments-raw.json found, extracting comments from posts data...");
    comments = extractCommentsFromPosts(posts);
    console.log(`Extracted ${comments.length} comments from latestComments in posts`);
  }

  const postMap = buildPostMap(posts);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("Extracting reply pairs...");
  const replyPairs = extractReplyPairs(comments, postMap);
  fs.writeFileSync(path.join(OUT_DIR, "reply-pairs.json"), JSON.stringify(replyPairs, null, 2));
  console.log(`  ${replyPairs.length} reply pairs`);

  const repliedCommentIds = new Set(
    comments
      .filter((c) => c.replies?.some((r) => isAccount(r.ownerUsername)))
      .map((c) => c.id)
  );

  console.log("Building all-comments pool...");
  const pool = extractAllCommentsPool(comments, postMap, repliedCommentIds);
  fs.writeFileSync(path.join(OUT_DIR, "all-comments-pool.json"), JSON.stringify(pool, null, 2));
  console.log(`  ${pool.length} comments (${repliedCommentIds.size} with MacKenzie reply)`);

  console.log("Extracting captions...");
  const captions = extractCaptions(posts);
  fs.writeFileSync(path.join(OUT_DIR, "captions.json"), JSON.stringify(captions, null, 2));
  console.log(`  ${captions.length} captions`);

  console.log("Computing voice analytics...");
  const analytics = computeVoiceAnalytics(replyPairs);
  fs.writeFileSync(path.join(OUT_DIR, "voice-analytics.json"), JSON.stringify(analytics, null, 2));
  console.log(`  Reply length: avg=${analytics.replyLengths.avg} chars, median=${analytics.replyLengths.median}`);
  console.log(`  Top phrases: ${analytics.commonPhrases.slice(0, 5).map((p) => p.phrase).join(", ")}`);
  console.log(`  Emojis: ${Object.keys(analytics.emojiUsage).length} unique`);

  console.log("Computing summary...");
  const summary = computeSummary(posts, comments, replyPairs);
  fs.writeFileSync(path.join(OUT_DIR, "scrape-summary.json"), JSON.stringify(summary, null, 2));

  console.log("\n=== Scrape Summary ===");
  console.log(`Posts: ${summary.totalPosts}`);
  console.log(`Comments: ${summary.totalComments}`);
  console.log(`Reply pairs: ${summary.totalReplyPairs}`);
  console.log(`Reply rate: ${(summary.replyRate * 100).toFixed(1)}%`);
  console.log(`Date range: ${summary.dateRange.earliest} → ${summary.dateRange.latest}`);
  console.log(`Avg replies/post: ${summary.avgRepliesPerPost}`);
  console.log(`\nTop commenters MacKenzie engages with:`);
  for (const c of summary.topEngagedCommenters.slice(0, 10)) {
    console.log(`  @${c.username}: ${c.replyCount} replies`);
  }

  console.log(`\nAll files saved to ${OUT_DIR}`);
}

main();
