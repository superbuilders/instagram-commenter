import * as fs from "fs";
import * as path from "path";

const SEARCH_QUERIES = [
  "MacKenzie Price podcast interview",
  "MacKenzie Price Alpha School podcast",
  "Future of Education MacKenzie Price",
  "2 Hour Learning MacKenzie Price",
  "MacKenzie Price education interview",
  "Alpha School founder podcast",
  "MacKenzie Price guest appearance",
];

const PODCAST_DIR = path.resolve(import.meta.dirname, "../../../data/podcasts");
const MANIFEST_PATH = path.join(PODCAST_DIR, "manifest.json");

interface Episode {
  title: string;
  url: string;
  platform: string;
  discoveredAt: string;
  transcribedAt: string | null;
  ingestedAt: string | null;
  transcriptPath: string | null;
  status: "discovered" | "transcribed" | "ingested" | "failed";
  error?: string;
}

interface Manifest {
  lastRunAt: string;
  episodes: Episode[];
}

function loadManifest(): Manifest {
  if (fs.existsSync(MANIFEST_PATH)) {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  }
  return { lastRunAt: new Date().toISOString(), episodes: [] };
}

function saveManifest(manifest: Manifest) {
  fs.mkdirSync(PODCAST_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

function isKnownUrl(manifest: Manifest, url: string): boolean {
  return manifest.episodes.some((e) => e.url === url);
}

async function searchYouTube(query: string): Promise<Episode[]> {
  const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
  if (!YOUTUBE_API_KEY) {
    console.log("  [YouTube] No YOUTUBE_API_KEY set, skipping YouTube search");
    return [];
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("key", YOUTUBE_API_KEY);
  url.searchParams.set("q", query);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "25");

  const response = await fetch(url.toString());
  if (!response.ok) {
    console.error(`  [YouTube] API error: ${response.status}`);
    return [];
  }

  const data = (await response.json()) as {
    items: Array<{
      id: { videoId: string };
      snippet: { title: string };
    }>;
  };

  return data.items.map((item) => ({
    title: item.snippet.title,
    url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
    platform: "youtube",
    discoveredAt: new Date().toISOString(),
    transcribedAt: null,
    ingestedAt: null,
    transcriptPath: null,
    status: "discovered" as const,
  }));
}

async function searchWeb(query: string): Promise<Episode[]> {
  // Uses a simple web search approach — can be enhanced with
  // Google Custom Search API, Bing API, or other search providers
  console.log(`  [Web] Searching: "${query}" (placeholder — add search API)`);
  return [];
}

async function discoverEpisodes(manifest: Manifest): Promise<Episode[]> {
  console.log("\n=== Discovery Phase ===");
  const newEpisodes: Episode[] = [];

  for (const query of SEARCH_QUERIES) {
    console.log(`\nSearching: "${query}"`);

    const ytResults = await searchYouTube(query);
    for (const ep of ytResults) {
      if (!isKnownUrl(manifest, ep.url)) {
        console.log(`  [NEW] ${ep.title}`);
        newEpisodes.push(ep);
      }
    }

    const webResults = await searchWeb(query);
    for (const ep of webResults) {
      if (!isKnownUrl(manifest, ep.url)) {
        console.log(`  [NEW] ${ep.title}`);
        newEpisodes.push(ep);
      }
    }

    // Rate limit between searches
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\nDiscovered ${newEpisodes.length} new episodes`);
  return newEpisodes;
}

async function transcribeEpisode(episode: Episode): Promise<string | null> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    console.error("  OPENAI_API_KEY required for Whisper transcription");
    return null;
  }

  // For YouTube videos, we need to download audio first
  // This requires yt-dlp or similar tool
  if (episode.platform === "youtube") {
    console.log(`  Downloading audio from: ${episode.url}`);

    const audioPath = path.join(
      PODCAST_DIR,
      `${sanitizeFilename(episode.title)}.mp3`
    );

    try {
      const { execSync } = await import("child_process");

      // Download as low-bitrate mono mp3 (64kbps, ~0.5MB/min = 25MB limit supports ~50 min)
      execSync(
        `yt-dlp -x --audio-format mp3 --postprocessor-args "ffmpeg:-ac 1 -ab 64k" -o "${audioPath}" "${episode.url}"`,
        { timeout: 600000 }
      );

      const fileSizeMB = fs.statSync(audioPath).size / (1024 * 1024);
      console.log(`  Downloaded: ${fileSizeMB.toFixed(1)}MB`);

      // Split into chunks if over 24MB (Whisper limit is 25MB)
      let audioPaths: string[] = [audioPath];
      if (fileSizeMB > 24) {
        console.log(`  Splitting into segments (file too large for Whisper)...`);
        const segmentDir = path.join(PODCAST_DIR, "segments");
        fs.mkdirSync(segmentDir, { recursive: true });
        const segmentPattern = path.join(
          segmentDir,
          `${sanitizeFilename(episode.title)}-%03d.mp3`
        );
        execSync(
          `ffmpeg -i "${audioPath}" -f segment -segment_time 2400 -ac 1 -ab 64k -y "${segmentPattern}"`,
          { timeout: 300000 }
        );
        audioPaths = fs
          .readdirSync(segmentDir)
          .filter((f) => f.startsWith(sanitizeFilename(episode.title)))
          .sort()
          .map((f) => path.join(segmentDir, f));
        console.log(`  Split into ${audioPaths.length} segments`);
      }

      // Transcribe each segment
      const transcriptParts: string[] = [];
      for (const segPath of audioPaths) {
        console.log(`  Transcribing${audioPaths.length > 1 ? ` segment ${transcriptParts.length + 1}/${audioPaths.length}` : ""} via Whisper API...`);
        const audioData = fs.readFileSync(segPath);
        const formData = new FormData();
        formData.append(
          "file",
          new Blob([audioData], { type: "audio/mp3" }),
          path.basename(segPath)
        );
        formData.append("model", "whisper-1");
        formData.append("response_format", "text");

        const response = await fetch(
          "https://api.openai.com/v1/audio/transcriptions",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
            body: formData,
          }
        );

        if (!response.ok) {
          throw new Error(`Whisper API error: ${response.status}`);
        }

        transcriptParts.push(await response.text());
      }

      const transcript = transcriptParts.join("\n\n");

      // Clean up audio files
      for (const p of audioPaths) {
        try { fs.unlinkSync(p); } catch {}
      }
      if (audioPaths[0] !== audioPath) {
        try { fs.unlinkSync(audioPath); } catch {}
      }

      return transcript;
    } catch (err) {
      console.error(
        `  Failed to transcribe: ${err instanceof Error ? err.message : err}`
      );
      return null;
    }
  }

  console.log(`  Unsupported platform: ${episode.platform}`);
  return null;
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9 -]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 100);
}

async function processEpisodes(manifest: Manifest): Promise<void> {
  const pending = manifest.episodes.filter(
    (e) => e.status === "discovered"
  );

  if (pending.length === 0) {
    console.log("\nNo pending episodes to transcribe.");
    return;
  }

  console.log(`\n=== Transcription Phase (${pending.length} episodes) ===`);

  for (const episode of pending) {
    console.log(`\nProcessing: ${episode.title}`);

    const transcript = await transcribeEpisode(episode);
    if (transcript) {
      const transcriptPath = path.join(
        PODCAST_DIR,
        `${sanitizeFilename(episode.title)}.txt`
      );
      fs.writeFileSync(transcriptPath, transcript);

      episode.transcribedAt = new Date().toISOString();
      episode.transcriptPath = transcriptPath;
      episode.status = "transcribed";
      console.log(
        `  ✓ Transcribed (${transcript.length} chars) → ${transcriptPath}`
      );
    } else {
      episode.status = "failed";
      episode.error = "Transcription failed";
      console.log(`  ✗ Failed`);
    }

    saveManifest(manifest);
  }
}

async function main() {
  console.log("=== Podcast Transcription Agent ===");
  console.log(`Data dir: ${PODCAST_DIR}`);
  fs.mkdirSync(PODCAST_DIR, { recursive: true });

  const manifest = loadManifest();
  console.log(
    `Manifest: ${manifest.episodes.length} known episodes`
  );

  // Discovery
  const newEpisodes = await discoverEpisodes(manifest);
  manifest.episodes.push(...newEpisodes);
  saveManifest(manifest);

  // Transcription
  await processEpisodes(manifest);

  // Summary
  manifest.lastRunAt = new Date().toISOString();
  saveManifest(manifest);

  const stats = {
    total: manifest.episodes.length,
    discovered: manifest.episodes.filter((e) => e.status === "discovered").length,
    transcribed: manifest.episodes.filter((e) => e.status === "transcribed").length,
    ingested: manifest.episodes.filter((e) => e.status === "ingested").length,
    failed: manifest.episodes.filter((e) => e.status === "failed").length,
  };

  console.log("\n=== Agent Complete ===");
  console.log(`  Total: ${stats.total}`);
  console.log(`  Transcribed: ${stats.transcribed}`);
  console.log(`  Awaiting ingestion: ${stats.transcribed} (run seed-knowledge after deploy)`);
  console.log(`  Failed: ${stats.failed}`);

  if (stats.discovered > 0) {
    console.log(
      `\n  ${stats.discovered} episodes still pending transcription.`
    );
    console.log(`  Re-run to continue processing.`);
  } else {
    console.log(`\n  All discovered episodes processed. Agent done.`);
  }
}

main().catch((err) => {
  console.error("Podcast agent failed:", err);
  process.exit(1);
});
