import * as fs from "fs";
import * as path from "path";
import { ne, desc } from "drizzle-orm";
import { evalResults } from "@instagram-commenter/core/db";
import {
  classifyComment,
  CLASSIFIER_MODEL,
  CLASSIFIER_POLICY_VERSION,
  CLASSIFIER_PROMPT_VERSION,
} from "@instagram-commenter/core/ai";
import { postMessage } from "@instagram-commenter/core/slack";
import { APP_TIME_ZONE, getLocalDateString, getLocalHour, getLocalWeekday } from "@instagram-commenter/core/time";
import { createCronHandler, log } from "./lib/handler.js";
import { getAnthropicKey, getSlackBotToken, getSlackChannelId } from "./lib/secrets.js";

interface GoldEntry {
  id: string;
  text: string;
  username: string;
  likesCount: number;
  postCaption: string;
  classification?: string | null;
  notes?: string | null;
  reviewed: boolean;
}

const CATEGORIES = [
  "narrative_shaping",
  "community_building",
  "informational",
  "delete",
  "skip",
];
const EVAL_LOCAL_HOUR = 9;
const EVAL_LOCAL_WEEKDAY = "Mon";

function normalizeGoldLabel(label?: string | null): string | null {
  if (!label) return null;
  const base = label.split(" (")[0].trim();
  if (base === "mixed") return null;
  if (CATEGORIES.includes(base)) return base;
  return null;
}

export const handler = createCronHandler("run-eval", async (db) => {
  const localHour = getLocalHour();
  const localWeekday = getLocalWeekday();
  if (localWeekday !== EVAL_LOCAL_WEEKDAY || localHour !== EVAL_LOCAL_HOUR) {
    log("info", "Skipping eval outside scheduled local time", {
      timeZone: APP_TIME_ZONE,
      localWeekday,
      localHour,
      scheduledLocalWeekday: EVAL_LOCAL_WEEKDAY,
      scheduledLocalHour: EVAL_LOCAL_HOUR,
    });
    return;
  }

  const anthropicKey = getAnthropicKey();
  const slackToken = getSlackBotToken();
  const channelId = getSlackChannelId();

  // Load gold dataset (bundled with Lambda)
  const goldPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "data/eval-dataset-reviewed.json"
  );

  let goldData: GoldEntry[];
  try {
    goldData = JSON.parse(fs.readFileSync(goldPath, "utf-8"));
  } catch {
    // Try alternate path for local dev
    const altPath = path.resolve(process.cwd(), "data/eval-dataset-reviewed.json");
    goldData = JSON.parse(fs.readFileSync(altPath, "utf-8"));
  }

  const evalSet = goldData
    .filter((e) => e.reviewed)
    .map((e) => ({ ...e, goldLabel: normalizeGoldLabel(e.notes) }))
    .filter((e) => e.goldLabel !== null) as (GoldEntry & { goldLabel: string })[];

  log("info", "Eval starting", { totalEntries: evalSet.length });

  // Run classification eval
  const confusion: Record<string, Record<string, number>> = {};
  for (const c of CATEGORIES) {
    confusion[c] = {};
    for (const c2 of CATEGORIES) confusion[c][c2] = 0;
  }

  let correct = 0;
  let total = 0;
  const perCategory: Record<string, { tp: number; fp: number; fn: number }> = {};
  for (const c of CATEGORIES) perCategory[c] = { tp: 0, fp: 0, fn: 0 };
  const confidenceBuckets = {
    low: { correct: 0, total: 0 },
    medium: { correct: 0, total: 0 },
    high: { correct: 0, total: 0 },
  };

  for (const entry of evalSet) {
    try {
      const result = await classifyComment(
        {
          commentText: entry.text,
          postCaption: entry.postCaption,
          likesCount: entry.likesCount,
          authorUsername: entry.username,
          isTopLevel: true,
        },
        anthropicKey
      );

      const predicted = result.classification;
      const gold = entry.goldLabel;
      const bucket =
        result.confidence < 0.7 ? "low" : result.confidence < 0.9 ? "medium" : "high";

      if (predicted === gold) {
        correct++;
        perCategory[gold].tp++;
        confidenceBuckets[bucket].correct++;
      } else {
        perCategory[gold].fn++;
        perCategory[predicted].fp++;
      }
      total++;
      confidenceBuckets[bucket].total++;

      if (confusion[gold] && confusion[gold][predicted] !== undefined) {
        confusion[gold][predicted]++;
      }
    } catch (err: any) {
      log("warn", "Eval entry failed", { id: entry.id, error: err.message });
      total++;
    }
  }

  const accuracy = total > 0 ? correct / total : 0;
  const today = getLocalDateString();

  // Compute per-category metrics
  const categoryMetrics: Record<string, { precision: number; recall: number; f1: number }> = {};
  for (const cat of CATEGORIES) {
    const { tp, fp, fn } = perCategory[cat];
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    categoryMetrics[cat] = { precision, recall, f1 };
  }

  // Store results
  await db
    .insert(evalResults)
    .values({
      evalDate: today,
      classificationAccuracy: accuracy,
      classificationCorrect: correct,
      classificationTotal: total,
      replyQualityAvg: null,
      evalType: "classification",
      promptVersion: CLASSIFIER_PROMPT_VERSION,
      policyVersion: CLASSIFIER_POLICY_VERSION,
      modelVersion: CLASSIFIER_MODEL,
      sampleSize: evalSet.length,
      metrics: {
        accuracy,
        correct,
        total,
      },
      slices: {
        confidenceBuckets: Object.fromEntries(
          Object.entries(confidenceBuckets).map(([bucket, stats]) => [
            bucket,
            {
              ...stats,
              accuracy: stats.total > 0 ? stats.correct / stats.total : 0,
            },
          ])
        ),
      },
      perCategory: categoryMetrics,
      confusion,
    })
    .onConflictDoNothing();

  // Get previous week's results for comparison
  const previousResults = await db
    .select()
    .from(evalResults)
    .where(ne(evalResults.evalDate, today))
    .orderBy(desc(evalResults.evalDate))
    .limit(1);

  const prevAccuracy = previousResults[0]?.classificationAccuracy ?? null;

  // Build comparison string
  let trend = "";
  if (prevAccuracy !== null) {
    const diff = accuracy - prevAccuracy;
    const diffPct = Math.round(diff * 100);
    if (diff > 0.02) trend = ` (↑ +${diffPct}% from last eval)`;
    else if (diff < -0.02) trend = ` (⚠️ ↓ ${diffPct}% from last eval)`;
    else trend = ` (stable)`;
  } else {
    trend = " (first eval)";
  }

  log("info", "Eval complete", {
    accuracy: Math.round(accuracy * 100),
    correct,
    total,
    trend,
  });

  // Post to Slack
  const accuracyPct = Math.round(accuracy * 100);
  const icon = prevAccuracy !== null && accuracy < prevAccuracy - 0.05 ? "⚠️" : "📊";

  const categoryLines = CATEGORIES
    .filter((c) => categoryMetrics[c].f1 > 0)
    .map((c) => {
      const m = categoryMetrics[c];
      const name = c.replace(/_/g, " ");
      return `  ${name}: P=${(m.precision * 100).toFixed(0)}% R=${(m.recall * 100).toFixed(0)}% F1=${(m.f1 * 100).toFixed(0)}%`;
    });

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${icon} Weekly Eval — ${today} (${APP_TIME_ZONE})` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Classification Accuracy:* ${accuracyPct}% (${correct}/${total})${trend}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: ["*Per-category:*", ...categoryLines].join("\n"),
      },
    },
  ];

  // Alert if accuracy dropped significantly
  if (prevAccuracy !== null && accuracy < prevAccuracy - 0.05) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `⚠️ *Accuracy dropped ${Math.round((prevAccuracy - accuracy) * 100)}% since last eval.* Check if knowledge bank or prompt changes caused regression.`,
      },
    });
  }

  await postMessage(channelId, blocks, `Weekly Eval — ${today} (${APP_TIME_ZONE}) — ${accuracyPct}% accuracy`, slackToken);
});
