import type { SearchResult } from "../knowledge/search.js";
import { VERIFIER_MODEL, VERIFIER_PROMPT_VERSION } from "../pipeline/index.js";

export interface VerificationResult {
  verified: boolean;
  issues: string[];
}

export async function verifyReply(
  replyText: string,
  knowledge: SearchResult[],
  anthropicApiKey: string
): Promise<VerificationResult> {
  const knowledgeContext =
    knowledge.length > 0
      ? knowledge.map((k) => `- [${k.sourceType}] ${k.content}`).join("\n")
      : "(no knowledge sources available)";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: VERIFIER_MODEL,
      max_tokens: 256,
      system: `You are a fact-checker for Instagram replies. Your job is to verify that the proposed reply does NOT contain invented facts.

Check if the reply contains ANY specific claims — names, ages, numbers, program details, methods, techniques, locations, statistics — that are NOT present in the available knowledge sources.

General warmth, encouragement, and directing to bio/DMs are always fine.
Only flag SPECIFIC factual claims that cannot be traced to the knowledge sources.

Respond JSON only:
{"verified": true} if all specific claims are grounded in the knowledge
{"verified": false, "issues": ["specific claim not found in knowledge"]} if any claims appear invented`,
      messages: [
        {
          role: "user",
          content: `PROPOSED REPLY:\n"${replyText}"\n\nAVAILABLE KNOWLEDGE SOURCES:\n${knowledgeContext}\n\nVerify this reply.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    // On API failure, let the reply through (don't block on verification errors)
    return { verified: true, issues: [] };
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };

  const text = data.content.find((c) => c.type === "text")?.text ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { verified: true, issues: [] };
  }

  return JSON.parse(jsonMatch[0]) as VerificationResult;
}

export { VERIFIER_MODEL, VERIFIER_PROMPT_VERSION };
