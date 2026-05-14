import { ApifyClient } from "apify-client";
import * as fs from "fs";
import * as path from "path";
import type { ApifyPostResult, ApifyCommentResult, ScrapeMetadata } from "./apify-types.js";

const ACCOUNT = "futureof_education";
const DATA_DIR = path.resolve(import.meta.dirname, "../../../data/apify-raw");
const COMMENT_BATCH_SIZE = 50;

function parseArgs(): { limit?: number } {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    return { limit: parseInt(args[limitIdx + 1], 10) };
  }
  return {};
}

async function scrapePosts(
  client: ApifyClient,
  limit?: number
): Promise<{ posts: ApifyPostResult[]; runId?: string }> {
  console.log(`\nScraping posts from @${ACCOUNT}...`);

  const input: Record<string, unknown> = {
    username: [ACCOUNT],
  };
  if (limit) {
    input.resultsLimit = limit;
    console.log(`  (limited to ${limit} posts)`);
  }

  const run = await client.actor("apify/instagram-post-scraper").call(input, {
    waitSecs: 600,
  });
  console.log(`  Actor run finished: https://console.apify.com/actors/runs/${run.id}`);

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const posts = items as unknown as ApifyPostResult[];

  console.log(`  Scraped ${posts.length} posts`);
  if (posts.length > 0) {
    const dates = posts.map((p) => p.timestamp).sort();
    console.log(`  Date range: ${dates[0]} → ${dates[dates.length - 1]}`);
  }

  return { posts, runId: run.id };
}

async function scrapeComments(
  client: ApifyClient,
  postUrls: string[],
  limit?: number
): Promise<{ comments: ApifyCommentResult[]; runId?: string }> {
  console.log(`\nScraping comments for ${postUrls.length} posts...`);

  const allComments: ApifyCommentResult[] = [];
  let lastRunId: string | undefined;

  const batches: string[][] = [];
  for (let i = 0; i < postUrls.length; i += COMMENT_BATCH_SIZE) {
    batches.push(postUrls.slice(i, i + COMMENT_BATCH_SIZE));
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`  Batch ${i + 1}/${batches.length} (${batch.length} posts)...`);

    const input: Record<string, unknown> = {
      directUrls: batch,
      includeReplies: true,
    };
    if (limit) {
      input.resultsLimit = limit;
    }

    const run = await client.actor("apify/instagram-comment-scraper").call(input, {
      waitSecs: 900,
    });
    lastRunId = run.id;
    console.log(`    Run: https://console.apify.com/actors/runs/${run.id}`);

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const comments = items as unknown as ApifyCommentResult[];
    allComments.push(...comments);
    console.log(`    Got ${comments.length} comments (total: ${allComments.length})`);
  }

  return { comments: allComments, runId: lastRunId };
}

async function main() {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    console.error("APIFY_TOKEN env var is required. Set it in .env or export it.");
    process.exit(1);
  }

  const { limit } = parseArgs();
  const client = new ApifyClient({ token });

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const { posts, runId: postRunId } = await scrapePosts(client, limit);
  const postsFile = path.join(DATA_DIR, "posts-raw.json");
  fs.writeFileSync(postsFile, JSON.stringify(posts, null, 2));
  console.log(`  Saved to ${postsFile}`);

  const postUrls = posts
    .map((p) => p.url)
    .filter(Boolean);

  if (postUrls.length === 0) {
    console.log("\nNo post URLs found. Skipping comment scraping.");
    return;
  }

  let comments: ApifyCommentResult[] = [];
  let commentRunId: string | undefined;
  try {
    const result = await scrapeComments(client, postUrls, limit);
    comments = result.comments;
    commentRunId = result.runId;

    const commentsFile = path.join(DATA_DIR, "comments-raw.json");
    fs.writeFileSync(commentsFile, JSON.stringify(comments, null, 2));
    console.log(`  Saved to ${commentsFile}`);
  } catch (err) {
    console.error("\nComment scraping failed (posts data is still saved):", err);
  }

  const metadata: ScrapeMetadata = {
    scrapedAt: new Date().toISOString(),
    postActorRunId: postRunId,
    commentActorRunId: commentRunId,
    totalPosts: posts.length,
    totalComments: comments.length,
    limitUsed: limit,
  };
  const metaFile = path.join(DATA_DIR, "scrape-metadata.json");
  fs.writeFileSync(metaFile, JSON.stringify(metadata, null, 2));
  console.log(`\nMetadata saved to ${metaFile}`);
  console.log(`\nDone! ${posts.length} posts, ${comments.length} comments scraped.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
