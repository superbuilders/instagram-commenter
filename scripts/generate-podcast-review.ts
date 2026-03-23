import * as fs from "fs";
import * as path from "path";

const manifestPath = path.resolve(
  new URL(".", import.meta.url).pathname,
  "../data/podcasts/manifest.json"
);

interface Episode {
  title: string;
  url: string;
  durationSeconds?: number;
  contentType?: string;
  contentTypeReason?: string;
  skip?: boolean;
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

// Dedupe
const seen = new Set<string>();
const unique: Episode[] = manifest.episodes.filter((e: Episode) => {
  if (seen.has(e.url)) return false;
  seen.add(e.url);
  return e.contentType;
});

// Group
const groups: Record<string, Episode[]> = {};
for (const e of unique) {
  const t = e.contentType ?? "unclassified";
  if (!groups[t]) groups[t] = [];
  groups[t].push(e);
}

function fmt(s?: number): string {
  if (!s) return "?";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

function clean(s: string): string {
  return (s || "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

const order = [
  "mackenzie_interview",
  "mackenzie_keynote",
  "alpha_own_content",
  "positive_coverage",
  "negative_coverage",
  "clip",
  "irrelevant",
];

const descriptions: Record<string, string> = {
  mackenzie_interview:
    "MacKenzie as a guest on podcasts/shows. **Highest value** for voice + talking points.",
  mackenzie_keynote: "MacKenzie giving talks or presentations.",
  alpha_own_content:
    "Content from Alpha School / 2 Hour Learning channels.",
  positive_coverage:
    "Third-party neutral/positive coverage about Alpha.",
  negative_coverage:
    "Third-party criticism. Useful as **counter-argument source** (what critics say, how to respond).",
  clip: "Short clips from longer episodes. Skip if full episode exists.",
  irrelevant: "Not useful for the knowledge bank.",
};

const lines: string[] = [];
lines.push("# MacKenzie Price — Podcast & Video Discovery Results");
lines.push("");
lines.push(`Discovered ${unique.length} unique episodes across YouTube.`);
lines.push("Classified by content type for ingestion routing.");
lines.push("");
lines.push("---");
lines.push("");

for (const type of order) {
  const eps = groups[type];
  if (!eps || eps.length === 0) continue;
  const toProcess = eps.filter((e) => !e.skip);
  const toSkip = eps.filter((e) => e.skip);
  const label = type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  lines.push(
    `## ${label} (${eps.length} total, ${toProcess.length} to transcribe)`
  );
  lines.push("");
  lines.push(`> ${descriptions[type]}`);
  lines.push("");

  for (const ep of toProcess) {
    lines.push(
      `- **${clean(ep.title)}** (${fmt(ep.durationSeconds)})`
    );
    lines.push(`  ${ep.url}`);
    lines.push(`  _${clean(ep.contentTypeReason ?? "")}_`);
    lines.push("");
  }

  if (toSkip.length > 0) {
    lines.push("### Skipped");
    lines.push("");
    for (const ep of toSkip) {
      lines.push(
        `- ~~${clean(ep.title)}~~ (${fmt(ep.durationSeconds)}) — ${clean(ep.contentTypeReason ?? "")}`
      );
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("");
}

// Summary table
lines.push("## Summary");
lines.push("");
lines.push("| Category | Total | Transcribe | Skip |");
lines.push("|----------|-------|------------|------|");
for (const type of order) {
  const eps = groups[type] || [];
  if (eps.length === 0) continue;
  const label = type.replace(/_/g, " ");
  const proc = eps.filter((e) => !e.skip).length;
  const skip = eps.filter((e) => e.skip).length;
  lines.push(`| ${label} | ${eps.length} | ${proc} | ${skip} |`);
}
lines.push("");

const transcribe = unique.filter((e) => !e.skip);
const totalMin = transcribe.reduce(
  (s, e) => s + (e.durationSeconds ?? 0) / 60,
  0
);
lines.push(
  `**Total to transcribe:** ${transcribe.length} episodes (~${Math.round(totalMin)} min of audio)`
);
lines.push(
  `**Estimated Whisper cost:** ~$${(totalMin * 0.006).toFixed(2)}`
);

const outputPath = path.resolve(
  new URL(".", import.meta.url).pathname,
  "../docs/podcast-discovery-review.md"
);
fs.writeFileSync(outputPath, lines.join("\n"));
console.log(`Written to ${outputPath}`);
