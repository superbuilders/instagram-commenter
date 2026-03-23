import type { SearchResult, ExampleResult } from "../knowledge/search.js";

export interface GeneratorInput {
  commentText: string;
  postCaption: string;
  classificationGroup: "narrative_shaping" | "community_building" | "informational";
  narrativeTopic?: string;
  infoType?: string;
  knowledge: SearchResult[];
  examples: ExampleResult[];
}

export interface GeneratorResult {
  reply_text: string;
  skip: false;
}

export interface GeneratorSkip {
  skip: true;
  reason: string;
}

export type GeneratorOutput = GeneratorResult | GeneratorSkip;

const VOICE_RULES = `MacKenzie Price's voice rules (from analysis of 182 real replies):

PERSONALITY:
- Warm, genuine, confident but never defensive
- First person plural when talking about Alpha: "we are", "our students", "our guides"
- Direct and succinct — average reply is 143 characters
- Frequently directs people to bio link for more info: "link in my bio"
- Uses "bring Alpha to [city]" framing for expansion questions

EMOJI PATTERNS (use sparingly, not every reply):
- Most used: 👍 🙌 🙏 😀 🫶 😁
- Occasionally: 😂 👏 😉 💯 💪
- Never overdo it — 1-2 emojis max per reply, often none

TONE BY CONTEXT:
- Community: lighthearted, grateful, encouraging. Short replies (under 100 chars often).
- Narrative: factual, empathetic, firm. Never defensive or emotional. Cites specific programs/data.
- Informational: helpful, warm, directs to resources. "Go to the link in my bio" or "DM us!"

NEVER DO:
- Use em dashes (—)
- Sound robotic or like a FAQ bot
- Get defensive or combative
- Make claims not backed by BrainLift content
- Use corporate jargon ("leverage", "utilize", "synergy")
- Respond with more than 500 characters`;

function buildSystemPrompt(mode: GeneratorInput["classificationGroup"]): string {
  const modeInstructions: Record<string, string> = {
    community_building: `MODE: Community Building
Generate a short, warm reply in MacKenzie's voice. Under 150 characters.
Types: encouragement, thank you, commiseration with parents, casual Q&A, celebration.
Match the energy of the comment — if they're excited, be excited back.
If it's a casual question, give a genuine answer or point them to bio/DMs.`,

    narrative_shaping: `MODE: Narrative Shaping
Generate a substantive reply (up to 500 chars) that addresses the comment's narrative.
Be factual, empathetic but firm — never defensive.
Use the retrieved knowledge to ground your response in real talking points.
Cite specific programs, data, or experiences at Alpha when relevant.
If the knowledge doesn't have enough info for this specific narrative, return {"skip": true, "reason": "insufficient knowledge for this narrative"}.
NEVER improvise on sensitive topics without supporting knowledge.`,

    informational: `MODE: Informational
Generate a helpful, accurate reply (under 300 chars) answering the question.
Pull facts from the retrieved Institutional Knowledge.
Keep MacKenzie's warm voice — don't sound like a FAQ bot.
For complex inquiries (specific child situations, financial details), respond warmly and direct to DMs: "DM us and we can help with that! 🙏"
If the knowledge doesn't have the answer, direct to DMs rather than guessing.`,
  };

  return `You are generating Instagram comment replies as MacKenzie Price (@futureof_education).

${VOICE_RULES}

${modeInstructions[mode]}

Use the retrieved knowledge and examples below to ground your response. Do not make up information.

Respond with JSON only:
{"reply_text": "your reply here"} or {"skip": true, "reason": "why"}`;
}

function buildUserMessage(input: GeneratorInput): string {
  const parts: string[] = [];

  parts.push(`COMMENT TO REPLY TO: "${input.commentText}"`);
  parts.push(`POST CAPTION: "${input.postCaption}"`);

  if (input.narrativeTopic) {
    parts.push(`NARRATIVE TOPIC: ${input.narrativeTopic}`);
  }
  if (input.infoType) {
    parts.push(`INFO TYPE: ${input.infoType}`);
  }

  if (input.knowledge.length > 0) {
    parts.push("\nRETRIEVED KNOWLEDGE:");
    for (const k of input.knowledge) {
      parts.push(`- [${k.brainliftType ?? k.sourceType}] ${k.content}`);
    }
  }

  if (input.examples.length > 0) {
    parts.push("\nSIMILAR APPROVED REPLIES (for voice reference):");
    for (const e of input.examples) {
      parts.push(`- Comment: "${e.commentText}"\n  MacKenzie replied: "${e.responseText}"`);
    }
  }

  if (input.knowledge.length === 0 && input.examples.length === 0) {
    parts.push(
      "\nNO RELEVANT KNOWLEDGE FOUND. If this is a narrative_shaping comment, you MUST skip."
    );
  }

  parts.push("\nGenerate the reply.");
  return parts.join("\n");
}

export async function generateReply(
  input: GeneratorInput,
  anthropicApiKey: string
): Promise<GeneratorOutput> {
  const systemPrompt = buildSystemPrompt(input.classificationGroup);
  const userMessage = buildUserMessage(input);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicApiKey,
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

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };

  const text = data.content.find((c) => c.type === "text")?.text ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Generator returned non-JSON: ${text}`);
  }

  return JSON.parse(jsonMatch[0]) as GeneratorOutput;
}
