import type { ApifyPostContextClient, ApifyPostContextResult } from "./jobs.js";

export interface CreateApifyPostContextClientOptions {
  token: string | null | undefined;
  actorId?: string;
  fetchImpl?: typeof fetch;
}

function actorPath(actorId: string): string {
  return actorId.replace("/", "~");
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function firstNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

export function normalizeApifyPostContextResult(
  postUrl: string,
  items: Array<Record<string, unknown>>
): ApifyPostContextResult {
  const item = items[0] ?? {};
  return {
    runId: firstString(item.runId),
    datasetId: firstString(item.datasetId),
    transcript:
      firstString(item.transcript) ??
      firstString(item.videoTranscript) ??
      firstString(item.captions) ??
      firstString(item.captionText),
    durationSeconds:
      firstNumber(item.durationSeconds) ??
      firstNumber(item.duration) ??
      firstNumber(item.videoDuration),
    thumbnailUrl:
      firstString(item.thumbnailUrl) ??
      firstString(item.displayUrl) ??
      firstString(item.imageUrl),
    sourceUrl:
      firstString(item.url) ??
      firstString(item.postUrl) ??
      firstString(item.videoUrl) ??
      postUrl,
    metadata: item,
  };
}

export function createApifyPostContextClient(
  options: CreateApifyPostContextClientOptions
): ApifyPostContextClient {
  const token = options.token?.trim();
  const actorId = options.actorId ?? "apify/instagram-reel-scraper";
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async fetchPostContext(input) {
      if (!token) {
        throw new Error("Apify token is missing");
      }

      const url = new URL(
        `https://api.apify.com/v2/acts/${actorPath(actorId)}/run-sync-get-dataset-items`
      );
      url.searchParams.set("token", token);
      url.searchParams.set("timeout", "120");

      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directUrls: [input.postUrl],
          resultsLimit: 1,
        }),
      });

      if (!response.ok) {
        throw new Error(`Apify actor failed ${response.status}: ${await response.text()}`);
      }

      const items = (await response.json()) as Array<Record<string, unknown>>;
      return normalizeApifyPostContextResult(input.postUrl, items);
    },
  };
}
