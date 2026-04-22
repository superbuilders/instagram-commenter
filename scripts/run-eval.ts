import * as fs from "fs";
import * as path from "path";
import {
  classifyComment as runClassifier,
  CLASSIFIER_MODEL,
  CLASSIFIER_POLICY_VERSION,
  CLASSIFIER_PROMPT_VERSION,
} from "@instagram-commenter/core/ai";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY required");
  process.exit(1);
}

const goldPath = path.resolve(process.cwd(), "data/eval-dataset-reviewed.json");

interface EvalEntry {
  id: string;
  text: string;
  username: string;
  likesCount: number;
  postCaption: string;
  classification: string;
  narrative_topic: string | null;
  info_type: string | null;
  ideal_response: string | null;
  mackenzieReply: string | null;
  notes: string;
  reviewed: boolean;
}

function normalizeGoldLabel(notes: string): string | null {
  if (!notes) return null;
  const base = notes.split(" (")[0].trim();
  if (base === "mixed") return null; // ambiguous, skip
  const valid = ["narrative_shaping", "community_building", "informational", "delete", "skip"];
  if (valid.includes(base)) return base;
  return null;
}

async function classifyComment(
  text: string,
  caption: string,
  likes: number,
  username: string
): Promise<Awaited<ReturnType<typeof import("@instagram-commenter/core/ai").classifyComment>>> {
  return runClassifier(
    {
      commentText: text,
      postCaption: caption,
      likesCount: likes,
      authorUsername: username,
      isTopLevel: true,
    },
    ANTHROPIC_API_KEY!
  );
}

async function main() {
  const entries: EvalEntry[] = JSON.parse(fs.readFileSync(goldPath, "utf-8"));

  // Filter to entries with valid gold labels
  const evalSet = entries
    .filter((e) => e.reviewed)
    .map((e) => ({ ...e, goldLabel: normalizeGoldLabel(e.notes) }))
    .filter((e) => e.goldLabel !== null) as (EvalEntry & { goldLabel: string })[];

  console.log(`\n=== Classification Eval ===`);
  console.log(`Total reviewed: ${entries.filter((e) => e.reviewed).length}`);
  console.log(`With valid gold labels: ${evalSet.length}`);
  console.log(`Skipped (mixed/ambiguous): ${entries.filter((e) => e.reviewed).length - evalSet.length}\n`);

  const results: {
    comment: string;
    gold: string;
    predicted: string;
    correct: boolean;
    confidence: number;
  }[] = [];

  const categories = ["narrative_shaping", "community_building", "informational", "delete", "skip"];
  const confidenceBuckets = {
    low: { correct: 0, total: 0 },
    medium: { correct: 0, total: 0 },
    high: { correct: 0, total: 0 },
  };
  const confusion: Record<string, Record<string, number>> = {};
  for (const c of categories) {
    confusion[c] = {};
    for (const c2 of categories) confusion[c][c2] = 0;
  }

  let correct = 0;
  let total = 0;

  for (let i = 0; i < evalSet.length; i++) {
    const entry = evalSet[i];
    try {
      const result = await classifyComment(
        entry.text,
        entry.postCaption,
        entry.likesCount,
        entry.username
      );

      const predicted = result.classification;
      const gold = entry.goldLabel;
      const isCorrect = predicted === gold;

      if (isCorrect) correct++;
      total++;

      const bucket =
        result.confidence < 0.7 ? "low" : result.confidence < 0.9 ? "medium" : "high";
      confidenceBuckets[bucket].total++;
      if (isCorrect) confidenceBuckets[bucket].correct++;

      if (confusion[gold] && confusion[gold][predicted] !== undefined) {
        confusion[gold][predicted]++;
      }

      results.push({
        comment: entry.text.slice(0, 80),
        gold,
        predicted,
        correct: isCorrect,
        confidence: result.confidence,
      });

      const icon = isCorrect ? "✅" : "❌";
      console.log(
        `  [${i + 1}/${evalSet.length}] ${icon} gold=${gold} pred=${predicted} (${Math.round(result.confidence * 100)}%) — "${entry.text.slice(0, 50)}..."`
      );
    } catch (err: any) {
      console.error(`  [${i + 1}] Error: ${err.message}`);
      total++;
    }
  }

  // --- Scorecard ---
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  CLASSIFICATION EVAL RESULTS`);
  console.log(`${"=".repeat(60)}`);
  console.log(`\n  Overall Accuracy: ${correct}/${total} (${Math.round((correct / total) * 100)}%)\n`);

  // Per-category P/R/F1
  console.log(`  Per-Category Metrics:`);
  console.log(`  ${"Category".padEnd(22)} ${"Prec".padEnd(8)} ${"Recall".padEnd(8)} ${"F1".padEnd(8)}`);
  console.log(`  ${"-".repeat(46)}`);

  for (const cat of categories) {
    const tp = confusion[cat]?.[cat] ?? 0;
    const predictedTotal = categories.reduce((sum, g) => sum + (confusion[g]?.[cat] ?? 0), 0);
    const goldTotal = categories.reduce((sum, p) => sum + (confusion[cat]?.[p] ?? 0), 0);

    const precision = predictedTotal > 0 ? tp / predictedTotal : 0;
    const recall = goldTotal > 0 ? tp / goldTotal : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    console.log(
      `  ${cat.padEnd(22)} ${precision.toFixed(2).padEnd(8)} ${recall.toFixed(2).padEnd(8)} ${f1.toFixed(2).padEnd(8)}`
    );
  }

  // Confusion matrix
  console.log(`\n  Confusion Matrix (rows=gold, cols=predicted):`);
  console.log(`  ${"".padEnd(22)} ${categories.map((c) => c.slice(0, 8).padEnd(10)).join("")}`);
  for (const gold of categories) {
    const row = categories.map((pred) => String(confusion[gold]?.[pred] ?? 0).padEnd(10));
    console.log(`  ${gold.padEnd(22)} ${row.join("")}`);
  }

  // Top misclassifications
  const misses = results.filter((r) => !r.correct);
  console.log(`\n  Top Misclassifications (${misses.length} total):`);
  const missCounts: Record<string, number> = {};
  for (const m of misses) {
    const key = `${m.gold} → ${m.predicted}`;
    missCounts[key] = (missCounts[key] || 0) + 1;
  }
  for (const [key, count] of Object.entries(missCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${key}: ${count}`);
  }

  console.log(`\n  Confidence calibration:`);
  for (const [bucket, stats] of Object.entries(confidenceBuckets)) {
    const accuracy = stats.total > 0 ? stats.correct / stats.total : 0;
    console.log(`    ${bucket}: ${stats.correct}/${stats.total} (${Math.round(accuracy * 100)}%)`);
  }

  // Save results
  const outPath = path.resolve(process.cwd(), "data/eval-results.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        policyVersion: CLASSIFIER_POLICY_VERSION,
        promptVersion: CLASSIFIER_PROMPT_VERSION,
        modelVersion: CLASSIFIER_MODEL,
        accuracy: correct / total,
        correct,
        total,
        sampleSize: evalSet.length,
        confidenceBuckets,
        results,
        confusion,
      },
      null,
      2
    )
  );
  console.log(`\n  Results saved to ${outPath}`);
}

main().catch(console.error);
