import type { BioPageFetchResult } from "./refresh.js";

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value: string): string {
  return decodeHtml(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function absolutizeUrl(url: string, baseUrl: string): string | null {
  if (url.startsWith("#") || url.startsWith("mailto:") || url.startsWith("tel:")) {
    return null;
  }

  try {
    return new URL(decodeHtml(url), baseUrl).toString();
  } catch {
    return null;
  }
}

export function parseBioPageHtml(html: string, pageUrl: string): BioPageFetchResult {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = stripTags(titleMatch?.[1] ?? pageUrl);
  const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      const attrs = match[1];
      const href = attrs.match(/\bhref=(["'])(.*?)\1/i)?.[2];
      if (!href) return null;
      const url = absolutizeUrl(href, pageUrl);
      if (!url) return null;
      return {
        title: stripTags(match[2]) || url,
        url,
      };
    })
    .filter((link): link is { title: string; url: string } => link != null);

  return {
    title,
    visibleText: stripTags(html),
    links,
  };
}

export async function fetchBioPage(url: string): Promise<BioPageFetchResult> {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "instagram-commenter/1.0 (+https://github.com/superbuilders/instagram-commenter)",
    },
  });

  if (!response.ok) {
    throw new Error(`Bio page fetch failed ${response.status}`);
  }

  const html = await response.text();
  return parseBioPageHtml(html, url);
}
