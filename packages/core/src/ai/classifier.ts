import {
  CLASSIFIER_MODEL,
  CLASSIFIER_POLICY_VERSION,
  CLASSIFIER_PROMPT_VERSION,
} from "../pipeline/index.js";

export interface ClassificationInput {
  commentText: string;
  postCaption: string;
  likesCount: number;
  authorUsername: string;
  isTopLevel: boolean;
}

export interface ClassificationResult {
  classification:
    | "narrative_shaping"
    | "community_building"
    | "informational"
    | "delete"
    | "skip";
  confidence: number;
  policy_version: string;
  narrative_topic?: string;
  info_type?: string;
  skip_reason?: string;
  delete_reason?: string;
  rationale_tags?: string[];
}

const SYSTEM_PROMPT = `You are a comment classifier for @futureof_education, MacKenzie Price's Instagram account (1M+ followers, Alpha School / 2 Hour Learning).

POLICY VERSION: ${CLASSIFIER_POLICY_VERSION}

Classify each comment into exactly ONE of these five categories:

1. NARRATIVE_SHAPING — The comment CHALLENGES or DEBATES Alpha's approach on a hot topic. The commenter disagrees, pushes back, or raises concerns:
   - Screen time / Sweden banning screens / screens harming learning
   - AI being bad for kids / ruining brains / destroying education
   - Traditional school vs Alpha School philosophy
   - Homeschooling debates
   - Any emerging narrative that challenges Alpha's approach
   IMPORTANT: If a comment is substantively PARTICIPATING in the public debate about AI, screen time, traditional school, or homeschooling, classify it as narrative_shaping even when the commenter generally agrees with Alpha. Reserve community_building for praise, cheerleading, or casual agreement without a real argument.
   Priority: comments with more likes = more visibility = higher priority.

2. COMMUNITY_BUILDING — Positive, casual, personal, or supportive comments:
   - Encouragement, praise, gratitude ("love this!", "you're amazing")
   - Commiseration with fellow parents about the school system
   - Casual questions ("where'd you get those boots?", "are you speaking at X?")
   - Emoji reactions from real users: 👏👏👏, ❤️❤️❤️, 🔥🔥🔥, 🙌, 💯 — these are community_building unless they are clearly bot-like or unintelligible
   - Loyal follower interactions
   - Comments that AGREE with Alpha's approach on AI/screen time (supportive, not debating)

3. INFORMATIONAL — Factual QUESTIONS or REQUESTS about Alpha School (the commenter is ASKING for information):
   - Enrollment questions ("how do I sign up?", "what ages?")
   - Location inquiries AND location wishes ("where are you located?", "bring Alpha to [city]!", "I wish you were in [state]!") — these are ALL informational with info_type "location"
   - Program details ("what curriculum?", "how does 2 hour learning work?")
   - Schedule, cost, admissions process
   - Requests to partner, franchise, or start a campus ("If you ever need someone to start a campus...")
   For complex/sensitive inquiries (specific child situations, financial details), classify as INFORMATIONAL with info_type "complex_redirect".
   IMPORTANT: Comments where someone is GIVING advice, sharing tips, or stating facts (not asking) are NOT informational — they are COMMUNITY_BUILDING or SKIP. Informational is ONLY for people seeking information from Alpha.

4. DELETE — Pure trolling, spam, or bad-faith comments with NO substantive argument:
   - Spam links, promo accounts, "check my profile" bots
   - One-word insults with zero argument: "scam", "cult", "fraud", "fake news", "grift"
   - Personal attacks on MacKenzie with no educational argument: "absolute psychotic", "brainwashing"
   - Comments that are ONLY hostile name-calling or accusations with nothing constructive
   KEY DISTINCTION: If a comment contains a genuine argument (even angry or wrong), it's NARRATIVE_SHAPING. If it's ONLY an insult/accusation with zero substance, it's DELETE. Examples:
   - "This is a scam" → DELETE (no argument)
   - "This is a scam because kids need real teachers not screens" → NARRATIVE_SHAPING (has an argument)
   - "Brainwashing and tokenizing your child" → DELETE (accusation only)
   - "AI can be wrong, I won't trust it to teach my child without human guidance" → NARRATIVE_SHAPING (genuine concern)

5. SKIP — Only for comments the bot truly cannot handle:
   - Comments mentioning specific children by name, mental health crises, abuse, or legal issues → HARD SKIP
   - Questions about specific individuals shown in a post ("how old is he?", "what's her name?", "where is she from?") → SKIP. MacKenzie should not answer personal questions about students in posts.
   - Comments giving unsolicited advice, safety tips, or corrections not directed at Alpha ("PLEASE only two finger CPR on an infant", "you should never do X with kids") → SKIP. These are sharing opinions, not asking Alpha anything.
   - Comments from verified or high-follower accounts (100K+) → SKIP with reason "flag_for_human"
   - Completely unintelligible comments
   NOTE: Do NOT skip emoji reactions from real users — those are COMMUNITY_BUILDING.

EXAMPLES (from human-reviewed corrections):

Comment: "👏👏👏" → COMMUNITY_BUILDING (emoji support from a real user)
Comment: "Amen 👏🫶🙌" → COMMUNITY_BUILDING (short praise)
Comment: "Scam" → DELETE (one-word accusation, zero substance)
Comment: "Absolute psychotic. Keep greedy grifters away from schools." → DELETE (personal attack, no argument)
Comment: "Ugh. We need you in south Chandler Arizona. 👏👏" → INFORMATIONAL (location request, info_type: "location")
Comment: "AI can be wrong. But I think from a physical human is ideal." → NARRATIVE_SHAPING (genuine argument about AI)
Comment: "Intentional screen time 🙌💙" → NARRATIVE_SHAPING (hot-topic support with a clear stance in the screen-time debate)
Comment: "AI is such an important tool to elevate learning!🙌" → NARRATIVE_SHAPING (substantive position on AI in education)
Comment: "May I ask how old he is? What a super star! 👏" → SKIP (personal question about a specific student in the post)
Comment: "PLEASE only two finger to CPR on an infant or you will broke his bones" → SKIP (unsolicited safety advice, not asking Alpha anything)

Respond with JSON only:
{
  "classification": "narrative_shaping" | "community_building" | "informational" | "delete" | "skip",
  "confidence": 0.0-1.0,
  "narrative_topic": "screen_time" | "ai_education" | "traditional_school" | "homeschool" | "other" (only for narrative_shaping),
  "info_type": "enrollment" | "location" | "program" | "schedule" | "cost" | "general" | "complex_redirect" (only for informational),
  "skip_reason": string (only for skip),
  "delete_reason": string (only for delete),
  "rationale_tags": string[] (optional, 1-3 short snake_case tags explaining the decision)
}`;

export async function classifyComment(
  input: ClassificationInput,
  anthropicApiKey: string
): Promise<ClassificationResult> {
  const userMessage = `Comment: "${input.commentText}"
Post caption: "${input.postCaption}"
Likes: ${input.likesCount}
Author: @${input.authorUsername}
Position: ${input.isTopLevel ? "top-level comment" : "reply in thread"}

Classify this comment.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLASSIFIER_MODEL,
      max_tokens: 256,
      system: SYSTEM_PROMPT,
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
    throw new Error(`Classifier returned non-JSON: ${text}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as ClassificationResult;
  return {
    ...parsed,
    policy_version: CLASSIFIER_POLICY_VERSION,
    rationale_tags: Array.isArray(parsed.rationale_tags)
      ? parsed.rationale_tags
          .filter((tag) => typeof tag === "string")
          .slice(0, 3)
      : undefined,
  };
}

export { CLASSIFIER_MODEL, CLASSIFIER_POLICY_VERSION, CLASSIFIER_PROMPT_VERSION };
