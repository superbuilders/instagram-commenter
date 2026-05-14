import * as fs from "fs";
import * as path from "path";

const MANIFEST_PATH = path.resolve(
  new URL(".", import.meta.url).pathname,
  "../data/podcasts/manifest.json"
);

interface Episode {
  title: string;
  url: string;
  platform: string;
  discoveredAt: string;
  transcribedAt: string | null;
  ingestedAt: string | null;
  transcriptPath: string | null;
  status: string;
  error?: string;
  contentType?: string;
  contentTypeReason?: string;
  youtubeDescription?: string;
  durationSeconds?: number;
  skip?: boolean;
}

interface Manifest {
  lastRunAt: string;
  episodes: Episode[];
}

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!YOUTUBE_API_KEY || !ANTHROPIC_API_KEY) {
  console.error("YOUTUBE_API_KEY and ANTHROPIC_API_KEY required");
  process.exit(1);
}

async function fetchVideoDetails(
  videoIds: string[]
): Promise<
  Map<
    string,
    { description: string; duration: string; channelTitle: string }
  >
> {
  const results = new Map<
    string,
    { description: string; duration: string; channelTitle: string }
  >();

  // YouTube API allows 50 IDs per request
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = new URL(
      "https://www.googleapis.com/youtube/v3/videos"
    );
    url.searchParams.set("key", YOUTUBE_API_KEY!);
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("part", "snippet,contentDetails");

    const response = await fetch(url.toString());
    if (!response.ok) {
      console.error(`YouTube API error: ${response.status}`);
      continue;
    }

    const data = (await response.json()) as {
      items: Array<{
        id: string;
        snippet: { description: string; channelTitle: string };
        contentDetails: { duration: string };
      }>;
    };

    for (const item of data.items) {
      results.set(item.id, {
        description: item.snippet.description.slice(0, 1000),
        duration: item.contentDetails.duration,
        channelTitle: item.snippet.channelTitle,
      });
    }
  }

  return results;
}

function parseDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (
    (parseInt(match[1] ?? "0") * 3600) +
    (parseInt(match[2] ?? "0") * 60) +
    parseInt(match[3] ?? "0")
  );
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h${m}m`;
  return `${m}m${s}s`;
}

async function classifyEpisode(
  title: string,
  description: string,
  channelTitle: string,
  durationSeconds: number
): Promise<{ contentType: string; reason: string; skip: boolean }> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      system: `Classify YouTube videos about MacKenzie Price / Alpha School / 2 Hour Learning.

Categories:
1. "mackenzie_interview" — MacKenzie Price is a guest on someone's podcast or show, speaking at length. HIGHEST VALUE for voice training.
2. "mackenzie_keynote" — MacKenzie giving a talk, presentation, or keynote.
3. "alpha_own_content" — Content published by Alpha School / @futureof_education / 2 Hour Learning's own channel.
4. "positive_coverage" — Third-party news or coverage that is neutral/positive about Alpha.
5. "negative_coverage" — Third-party content that criticizes or is skeptical of Alpha. Useful as counter-argument source material.
6. "clip" — A short clip (<3 min) extracted from a longer episode that likely exists separately.
7. "irrelevant" — Not actually about MacKenzie Price or Alpha School, or too tangential to be useful.

Also flag if this should be skipped (clips under 2 min, irrelevant, or exact duplicate content of another category).

Respond JSON only: {"contentType": "...", "reason": "one line", "skip": true/false}`,
      messages: [
        {
          role: "user",
          content: `Title: ${title}\nChannel: ${channelTitle}\nDuration: ${formatDuration(durationSeconds)}\nDescription: ${description.slice(0, 500)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    return { contentType: "unknown", reason: "API error", skip: false };
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };

  const text = data.content.find((c) => c.type === "text")?.text ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { contentType: "unknown", reason: "Parse error", skip: false };
  }

  return JSON.parse(jsonMatch[0]);
}

async function main() {
  const manifest: Manifest = JSON.parse(
    fs.readFileSync(MANIFEST_PATH, "utf-8")
  );

  // Dedupe by URL first
  const seen = new Set<string>();
  const deduped: Episode[] = [];
  for (const ep of manifest.episodes) {
    if (!seen.has(ep.url)) {
      seen.add(ep.url);
      deduped.push(ep);
    }
  }
  console.log(
    `Deduped: ${manifest.episodes.length} → ${deduped.length} unique URLs`
  );

  // Filter to relevant only
  const relevant = deduped.filter((e) => {
    const t = e.title.toLowerCase();
    return (
      t.includes("mackenzie price") ||
      t.includes("alpha school") ||
      t.includes("2 hour learning") ||
      t.includes("2hr learning") ||
      t.includes("future of education") ||
      t.includes("future_of_education") ||
      t.includes("gt.school")
    );
  });

  console.log(`Relevant episodes: ${relevant.length}`);

  // Fetch YouTube metadata
  console.log("\nFetching YouTube metadata...");
  const videoIds = relevant.map((e) => {
    const match = e.url.match(/v=([^&]+)/);
    return match ? match[1] : "";
  }).filter(Boolean);

  const details = await fetchVideoDetails(videoIds);
  console.log(`Got metadata for ${details.size} videos`);

  // Classify each
  console.log("\nClassifying episodes...\n");

  const categories: Record<string, Episode[]> = {};

  for (const ep of relevant) {
    const videoId = ep.url.match(/v=([^&]+)/)?.[1] ?? "";
    const meta = details.get(videoId);

    const duration = meta ? parseDuration(meta.duration) : 0;
    ep.durationSeconds = duration;
    ep.youtubeDescription = meta?.description;

    const result = await classifyEpisode(
      ep.title,
      meta?.description ?? "",
      meta?.channelTitle ?? "",
      duration
    );

    ep.contentType = result.contentType;
    ep.contentTypeReason = result.reason;
    ep.skip = result.skip;

    if (!categories[result.contentType]) {
      categories[result.contentType] = [];
    }
    categories[result.contentType].push(ep);

    const durStr = duration > 0 ? ` (${formatDuration(duration)})` : "";
    const skipStr = result.skip ? " [SKIP]" : "";
    console.log(
      `  [${result.contentType}]${skipStr} ${ep.title}${durStr}`
    );
    console.log(`    → ${result.reason}`);
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("CLASSIFICATION SUMMARY\n");

  for (const [type, eps] of Object.entries(categories).sort()) {
    const toProcess = eps.filter((e) => !e.skip);
    const toSkip = eps.filter((e) => e.skip);
    console.log(
      `${type}: ${eps.length} total (${toProcess.length} to transcribe, ${toSkip.length} skip)`
    );
    for (const ep of toProcess) {
      console.log(`  ✓ ${ep.title} (${formatDuration(ep.durationSeconds!)})`);
    }
    for (const ep of toSkip) {
      console.log(`  ✗ ${ep.title} — ${ep.contentTypeReason}`);
    }
    console.log();
  }

  const toTranscribe = relevant.filter((e) => !e.skip);
  const totalMinutes = toTranscribe.reduce(
    (sum, e) => sum + (e.durationSeconds ?? 0) / 60,
    0
  );
  console.log(
    `TOTAL TO TRANSCRIBE: ${toTranscribe.length} episodes (~${Math.round(totalMinutes)} min of audio)`
  );

  // Save updated manifest with classifications
  manifest.episodes = deduped;
  manifest.lastRunAt = new Date().toISOString();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log("\nManifest updated with classifications.");
}

main().catch((err) => {
  console.error("Classification failed:", err);
  process.exit(1);
});
