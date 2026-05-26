import * as fs from "fs";
import * as path from "path";
import type { ApifyCommentResult, ApifyPostResult } from "./apify-types.js";

const RAW_DIR = path.resolve(import.meta.dirname, "../../../data/apify-raw");

interface Args {
  allowGaps: boolean;
  top: number;
}

interface PostCoverage {
  postId: string;
  permalink: string;
  expectedComments: number;
  observedComments: number;
  missingComments: number;
}

function parseArgs(argv: string[]): Args {
  const args = { allowGaps: false, top: 10 };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--allow-gaps") {
      args.allowGaps = true;
    } else if (arg === "--top") {
      args.top = Number(argv[++i]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.top) || args.top <= 0) {
    throw new Error("--top must be a positive integer");
  }

  return args;
}

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function postKey(post: ApifyPostResult): string {
  return post.url || post.shortCode || post.id;
}

function commentPostKeys(comment: ApifyCommentResult): string[] {
  return [comment.postUrl, comment.postShortCode].filter(Boolean) as string[];
}

function countObservedByPost(
  posts: ApifyPostResult[],
  comments: ApifyCommentResult[] | null
): Map<string, number> {
  const counts = new Map<string, number>();

  if (comments) {
    const postLookup = new Map<string, string>();
    for (const post of posts) {
      if (post.url) postLookup.set(post.url, postKey(post));
      if (post.shortCode) postLookup.set(post.shortCode, postKey(post));
    }

    for (const comment of comments) {
      const key = commentPostKeys(comment)
        .map((candidate) => postLookup.get(candidate))
        .find(Boolean);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return counts;
  }

  for (const post of posts) {
    const latestComments = (post as any).latestComments as unknown[] | undefined;
    counts.set(postKey(post), latestComments?.length ?? 0);
  }

  return counts;
}

function buildCoverage(
  posts: ApifyPostResult[],
  comments: ApifyCommentResult[] | null
): PostCoverage[] {
  const observedByPost = countObservedByPost(posts, comments);

  return posts.map((post) => {
    const expectedComments = post.commentsCount ?? 0;
    const observedComments = observedByPost.get(postKey(post)) ?? 0;
    return {
      postId: post.id,
      permalink: post.url,
      expectedComments,
      observedComments,
      missingComments: Math.max(0, expectedComments - observedComments),
    };
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const postsFile = path.join(RAW_DIR, "posts-raw.json");
  const commentsFile = path.join(RAW_DIR, "comments-raw.json");

  if (!fs.existsSync(postsFile)) {
    console.error(`Missing ${postsFile}. Run the scraper first.`);
    process.exit(1);
  }

  const posts = loadJson<ApifyPostResult[]>(postsFile);
  const comments = fs.existsSync(commentsFile)
    ? loadJson<ApifyCommentResult[]>(commentsFile)
    : null;

  const coverage = buildCoverage(posts, comments);
  const expectedTotal = coverage.reduce((sum, row) => sum + row.expectedComments, 0);
  const observedTotal = coverage.reduce((sum, row) => sum + row.observedComments, 0);
  const missingTotal = coverage.reduce((sum, row) => sum + row.missingComments, 0);
  const postsWithGaps = coverage.filter((row) => row.missingComments > 0);

  console.log("=== Comment Coverage Audit ===");
  console.log(`Source mode: ${comments ? "comments-raw.json" : "posts.latestComments fallback"}`);
  console.log(`Posts: ${posts.length}`);
  console.log(`Expected comments from post counts: ${expectedTotal}`);
  console.log(`Observed comments in local raw data: ${observedTotal}`);
  console.log(`Missing comments implied by counts: ${missingTotal}`);
  console.log(`Posts with coverage gaps: ${postsWithGaps.length}`);

  if (postsWithGaps.length > 0) {
    console.log(`\nTop ${Math.min(args.top, postsWithGaps.length)} gaps:`);
    for (const row of postsWithGaps
      .sort((a, b) => b.missingComments - a.missingComments)
      .slice(0, args.top)) {
      console.log(
        [
          `missing=${row.missingComments}`,
          `observed=${row.observedComments}`,
          `expected=${row.expectedComments}`,
          row.permalink,
        ].join(" | ")
      );
    }
  }

  if (missingTotal > 0 && !args.allowGaps) {
    process.exit(1);
  }
}

main();
