import * as fs from "fs";
import * as path from "path";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY required");
  process.exit(1);
}

const evalPath = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../data/eval-dataset-reviewed.json"
);

interface EvalEntry {
  id: string;
  text: string;
  username: string;
  likesCount: number;
  postCaption: string;
  classification: string;
  narrative_topic: string | null;
  info_type: string | null;
  mackenzieReply: string | null;
  notes: string;
}

// Read the current generator prompts directly from source
function getGeneratorSource(): string {
  const genPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../packages/core/src/ai/generator.ts"
  );
  return fs.readFileSync(genPath, "utf-8");
}

function extractVoiceRules(source: string): string {
  const match = source.match(/const VOICE_RULES = `([\s\S]*?)`;/);
  return match ? match[1] : "";
}

function extractModeInstruction(source: string, mode: string): string {
  const regex = new RegExp(`${mode}: \`([\\s\\S]*?)\``);
  const match = source.match(regex);
  return match ? match[1] : "";
}

async function generateReply(
  comment: string,
  caption: string,
  mode: string,
  voiceRules: string,
  modeInstruction: string,
): Promise<string> {
  const systemPrompt = `You are generating Instagram comment replies as MacKenzie Price (@futureof_education).

${voiceRules}

${modeInstruction}

Read the POST CAPTION below — your reply should feel like part of the conversation under THIS specific post.

Use any knowledge context provided to ground your response. Do not make up information.

Respond with JSON only:
{"reply_text": "your reply here"} or {"skip": true, "reason": "why"}`;

  const userMessage = `COMMENT TO REPLY TO: "${comment}"
POST CAPTION: "${caption}"

Generate the reply.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) throw new Error(`API error: ${response.status}`);

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };

  const text = data.content.find((c) => c.type === "text")?.text ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return "[parse error]";

  const parsed = JSON.parse(jsonMatch[0]);
  return parsed.skip ? `[SKIPPED: ${parsed.reason}]` : parsed.reply_text;
}

async function judgeReplies(
  comment: string,
  caption: string,
  replyA: string,
  replyB: string,
  mackenzieReply: string | null,
): Promise<{ scoreA: number; scoreB: number; reasoning: string }> {
  const macRef = mackenzieReply
    ? `\nMacKenzie's actual reply (for reference): "${mackenzieReply}"`
    : "";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      system: `You are evaluating Instagram comment replies for voice quality. Score each reply 1-10 on four dimensions:
1. SPECIFICITY — Does it address what the commenter actually said? (vs generic brand defense)
2. VOICE MATCH — Does it sound like a real person, warm and natural? (vs robotic FAQ bot)
3. RELEVANCE — Is it appropriate for this comment under this post?
4. NATURALNESS — Would this feel normal as an Instagram reply? (right length, tone, emoji usage)

Respond JSON only:
{"scoreA": average_1_to_10, "scoreB": average_1_to_10, "reasoning": "brief comparison"}`,
      messages: [
        {
          role: "user",
          content: `Comment: "${comment}"
Post caption: "${caption}"${macRef}

Reply A: "${replyA}"
Reply B: "${replyB}"

Score both replies.`,
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`Judge API error: ${response.status}`);

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };

  const text = data.content.find((c) => c.type === "text")?.text ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { scoreA: 0, scoreB: 0, reasoning: "parse error" };

  return JSON.parse(jsonMatch[0]);
}

async function main() {
  const entries: EvalEntry[] = JSON.parse(fs.readFileSync(evalPath, "utf-8"));

  // Pick 10 diverse comments: mix of categories
  const categories = ["narrative_shaping", "community_building", "informational"];
  const selected: EvalEntry[] = [];

  for (const cat of categories) {
    const pool = entries.filter(
      (e) => e.notes.startsWith(cat) && e.reviewed
    );
    // Pick 3-4 from each category
    const count = cat === "narrative_shaping" ? 4 : 3;
    selected.push(...pool.slice(0, count));
  }

  console.log(`\n=== Reply Quality Eval (${selected.length} comments) ===\n`);

  const genSource = getGeneratorSource();
  const voiceRules = extractVoiceRules(genSource);

  // We generate with the CURRENT prompt (which includes our updates)
  // To compare before/after, we also generate with the OLD prompts

  const OLD_COMMUNITY = `MODE: Community Building
Generate a short, warm reply in MacKenzie's voice. Under 150 characters.
Types: encouragement, thank you, commiseration with parents, casual Q&A, celebration.
Match the energy of the comment — if they're excited, be excited back.
If it's a casual question, give a genuine answer or point them to bio/DMs.`;

  const OLD_NARRATIVE = `MODE: Narrative Shaping
Generate a substantive reply (up to 500 chars) that addresses the comment's narrative.
Be factual, empathetic but firm — never defensive.
Use the retrieved knowledge to ground your response in real talking points.
Cite specific programs, data, or experiences at Alpha when relevant.
If the knowledge doesn't have enough info for this specific narrative, return {"skip": true, "reason": "insufficient knowledge for this narrative"}.
NEVER improvise on sensitive topics without supporting knowledge.`;

  const OLD_INFO = `MODE: Informational
Generate a helpful, accurate reply (under 300 chars) answering the question.
Pull facts from the retrieved Institutional Knowledge.
Keep MacKenzie's warm voice — don't sound like a FAQ bot.
For complex inquiries (specific child situations, financial details), respond warmly and direct to DMs: "DM us and we can help with that! 🙏"
If the knowledge doesn't have the answer, direct to DMs rather than guessing.`;

  const oldModes: Record<string, string> = {
    narrative_shaping: OLD_NARRATIVE,
    community_building: OLD_COMMUNITY,
    informational: OLD_INFO,
  };

  const results: {
    comment: string;
    category: string;
    oldReply: string;
    newReply: string;
    scoreOld: number;
    scoreNew: number;
    reasoning: string;
    mackenzieReply: string | null;
  }[] = [];

  for (let i = 0; i < selected.length; i++) {
    const entry = selected[i];
    const cat = entry.notes.split(" (")[0].trim();
    const mode = categories.includes(cat) ? cat : "community_building";

    console.log(`  [${i + 1}/${selected.length}] ${mode}: "${entry.text.slice(0, 60)}..."`);

    const newModeInstruction = extractModeInstruction(genSource, mode);
    const oldModeInstruction = oldModes[mode] || oldModes.community_building;

    const [oldReply, newReply] = await Promise.all([
      generateReply(entry.text, entry.postCaption, mode, voiceRules, oldModeInstruction),
      generateReply(entry.text, entry.postCaption, mode, voiceRules, newModeInstruction),
    ]);

    const judgment = await judgeReplies(
      entry.text,
      entry.postCaption,
      oldReply,
      newReply,
      entry.mackenzieReply,
    );

    results.push({
      comment: entry.text.slice(0, 100),
      category: mode,
      oldReply,
      newReply,
      scoreOld: judgment.scoreA,
      scoreNew: judgment.scoreB,
      reasoning: judgment.reasoning,
      mackenzieReply: entry.mackenzieReply,
    });

    console.log(`    OLD (${judgment.scoreA}/10): "${oldReply.slice(0, 80)}..."`);
    console.log(`    NEW (${judgment.scoreB}/10): "${newReply.slice(0, 80)}..."`);
    if (entry.mackenzieReply) {
      console.log(`    MAC: "${entry.mackenzieReply.slice(0, 80)}..."`);
    }
    console.log(`    Judge: ${judgment.reasoning}\n`);
  }

  // Summary
  const avgOld = results.reduce((s, r) => s + r.scoreOld, 0) / results.length;
  const avgNew = results.reduce((s, r) => s + r.scoreNew, 0) / results.length;

  console.log(`${"=".repeat(60)}`);
  console.log(`  REPLY QUALITY RESULTS`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Old prompt avg: ${avgOld.toFixed(1)}/10`);
  console.log(`  New prompt avg: ${avgNew.toFixed(1)}/10`);
  console.log(`  Change: ${avgNew > avgOld ? "+" : ""}${(avgNew - avgOld).toFixed(1)}`);
  console.log();

  for (const cat of categories) {
    const catResults = results.filter((r) => r.category === cat);
    if (catResults.length === 0) continue;
    const catOld = catResults.reduce((s, r) => s + r.scoreOld, 0) / catResults.length;
    const catNew = catResults.reduce((s, r) => s + r.scoreNew, 0) / catResults.length;
    console.log(`  ${cat}: ${catOld.toFixed(1)} → ${catNew.toFixed(1)}`);
  }

  // Save
  const outPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../data/eval-replies-results.json"
  );
  fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), avgOld, avgNew, results }, null, 2));
  console.log(`\n  Results saved to ${outPath}`);
}

main().catch(console.error);
