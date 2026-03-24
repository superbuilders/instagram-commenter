import * as fs from "fs";
import * as path from "path";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY required");
  process.exit(1);
}

const evalPath = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../data/eval-dataset.json"
);

interface EvalEntry {
  id: string;
  text: string;
  username: string;
  likesCount: number;
  postCaption: string;
  classification: string | null;
  narrative_topic: string | null;
  info_type: string | null;
  ideal_response: string | null;
  notes: string;
}

async function classifyComment(text: string, caption: string, likes: number, username: string) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 256,
      system: `You classify Instagram comments for @futureof_education (MacKenzie Price, Alpha School).

Categories:
1. narrative_shaping — touches hot topics (screen time, AI in education, traditional school criticism)
2. community_building — positive, casual, personal (praise, encouragement, casual questions)
3. informational — factual questions about Alpha (enrollment, locations, programs, cost)
4. delete — pure spam, troll, bad-faith (NEVER delete legitimate criticism, even hostile)
5. skip — single emojis, mentions specific children/mental health/legal, needs human handling

Respond JSON only:
{"classification":"...","confidence":0.0-1.0,"narrative_topic":"screen_time|ai_education|traditional_school|homeschool|other","info_type":"enrollment|location|program|schedule|cost|general|complex_redirect","skip_reason":"...","delete_reason":"..."}`,
      messages: [
        {
          role: "user",
          content: `Comment: "${text}"\nPost caption: "${caption}"\nLikes: ${likes}\nAuthor: @${username}\n\nClassify.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };

  const responseText = data.content.find((c) => c.type === "text")?.text ?? "";
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Non-JSON response");

  return JSON.parse(jsonMatch[0]);
}

async function main() {
  const entries: EvalEntry[] = JSON.parse(fs.readFileSync(evalPath, "utf-8"));
  console.log(`Labeling ${entries.length} comments...\n`);

  const stats: Record<string, number> = {};
  let labeled = 0;

  for (const entry of entries) {
    try {
      const result = await classifyComment(
        entry.text,
        entry.postCaption,
        entry.likesCount,
        entry.username
      );

      entry.classification = result.classification;
      entry.narrative_topic = result.narrative_topic ?? null;
      entry.info_type = result.info_type ?? null;

      stats[result.classification] = (stats[result.classification] || 0) + 1;
      labeled++;

      const conf = Math.round((result.confidence ?? 0) * 100);
      console.log(
        `  [${labeled}/${entries.length}] ${result.classification} (${conf}%) — "${entry.text.slice(0, 60)}..."`
      );
    } catch (err: any) {
      console.error(`  [${labeled + 1}] Failed: ${err.message}`);
      labeled++;
    }
  }

  fs.writeFileSync(evalPath, JSON.stringify(entries, null, 2));

  console.log(`\n=== Labeling Complete ===`);
  console.log(`Labeled: ${labeled}/${entries.length}`);
  console.log(`\nBreakdown:`);
  for (const [cat, count] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log(`\nSaved to ${evalPath}`);
  console.log(`Jay/team can review and correct any misclassifications.`);
}

main();
