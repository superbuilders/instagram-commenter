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
  narrative_topic?: string;
  info_type?: string;
  skip_reason?: string;
  delete_reason?: string;
}

const SYSTEM_PROMPT = `You are a comment classifier for @futureof_education, MacKenzie Price's Instagram account (1M+ followers, Alpha School / 2 Hour Learning).

Classify each comment into exactly ONE of these five categories:

1. NARRATIVE_SHAPING — The comment touches a hot topic where MacKenzie needs to weigh in publicly. High-visibility threads about:
   - Screen time / Sweden banning screens / screens harming learning
   - AI being bad for kids / ruining brains / destroying education
   - Traditional school vs Alpha School philosophy
   - Homeschooling debates
   - Any emerging narrative that challenges Alpha's approach
   Priority: comments with more likes = more visibility = higher priority for narrative shaping.

2. COMMUNITY_BUILDING — Positive, casual, personal comments where MacKenzie's warm touch matters:
   - Encouragement, praise, gratitude ("love this!", "you're amazing")
   - Commiseration with fellow parents about the school system
   - Casual questions ("where'd you get those boots?", "are you speaking at X?")
   - Emoji reactions, lighthearted moments
   - Loyal follower interactions

3. INFORMATIONAL — Factual questions about Alpha School that deserve an answer:
   - Enrollment questions ("how do I sign up?", "what ages?")
   - Location inquiries ("where are you located?", "when are you opening in X?")
   - Program details ("what curriculum?", "how does 2 hour learning work?")
   - Schedule, cost, admissions process
   For complex/sensitive inquiries (specific child situations, financial details), still classify as INFORMATIONAL but note info_type as "complex_redirect" — the bot will direct them to DMs.

4. DELETE — Pure trolling, spam, or bad-faith actors with no substantive content:
   - Spam links, promo accounts, "check my profile" bots
   - Pure trolling with zero substance ("scam", "cult", "fraud" with nothing else)
   - Foreign language spam
   CRITICAL: Negative opinions about Alpha School, screen time, AI, education philosophy are NEVER delete — even if hostile in tone. Only pure trolls and spam. When in doubt, classify as SKIP, not DELETE.

5. SKIP — Everything else:
   - Single emojis or very short non-substantive comments
   - Comments mentioning specific children, mental health, abuse, or legal issues → HARD SKIP
   - Comments from verified or high-follower accounts → SKIP with reason "flag_for_human" (these need personal attention from Jay/MacKenzie)
   - Anything the bot shouldn't touch

Respond with JSON only:
{
  "classification": "narrative_shaping" | "community_building" | "informational" | "delete" | "skip",
  "confidence": 0.0-1.0,
  "narrative_topic": "screen_time" | "ai_education" | "traditional_school" | "homeschool" | "other" (only for narrative_shaping),
  "info_type": "enrollment" | "location" | "program" | "schedule" | "cost" | "general" | "complex_redirect" (only for informational),
  "skip_reason": string (only for skip),
  "delete_reason": string (only for delete)
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
      model: "claude-sonnet-4-20250514",
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

  return JSON.parse(jsonMatch[0]) as ClassificationResult;
}
