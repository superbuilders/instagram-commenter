# Jay Feedback Improvement Plan

Date: 2026-05-22
Repo: `instagram-commenter`
Primary user: Jay Lyons
Channel: `#foe-bot`

## Why This Matters

The Instagram bot is an active GTM workstream because Instagram comments are public narrative surfaces for MacKenzie, Future of Education, and Alpha. The value is not "reply to more comments." The value is:

- Surface the highest-leverage comments Jay would otherwise miss.
- Avoid wasting Jay's attention on emoji/fluff.
- Draft strong replies to hard questions and visible objections.
- Turn Jay's approvals, edits, and rejections into a real feedback loop.

Jay's latest email feedback was direct:

- He stopped training because the bot is mostly answering emoji/general-fluff comments.
- He is rejecting those, but the bot does not appear to change behavior.
- The most useful improvement is answering tougher questions and deep thoughts.
- It should use prior Instagram answers that have already been given.

## Current Symptoms

From `#foe-bot` on 2026-05-22:

- Recent Slack cards are dominated by `community building` replies.
- Many proposed replies are low-leverage: emoji acknowledgments, teacher giveaway thank-yous, generic "love this" style responses.
- Daily digest still reports many narrative/informational knowledge gaps:
  - `traditional_school`
  - `ai_education`
  - `screen_time`
- Digests show zero approvals/edits/rejections in recent daily snapshots, which means either Jay is not currently reviewing or interactions are not surfacing in the digest as expected.

This matches Jay's complaint: the channel is busy, but not necessarily useful.

## Code Findings

### 1. Negative Feedback Is Stored But Not Used For Routing

`packages/functions/src/slack-approval.ts` stores approved, edited, and rejected examples.

- Approved examples are inserted as positive examples.
- Edited originals are inserted as negative examples and edited versions as positive examples.
- Rejected replies are inserted as negative examples with reason and notes.

But `packages/core/src/knowledge/search.ts` retrieves only positive examples during reply generation:

```ts
searchExamples(commentText, {
  classificationGroup,
  positiveOnly: true,
  limit: 3,
  minSimilarity: 0.3,
})
```

So Jay can reject the same kind of reply repeatedly without the allocator/generator learning to suppress it.

### 2. Ranking Is Too Simple

`packages/core/src/scheduling/allocator.ts` sorts by:

1. classification priority
2. likes count

It does not account for:

- low-effort/fluff cost
- similarity to rejected `should_not_reply` examples
- knowledge retrieval strength
- topic importance
- Jay's historic approval rate by topic/category
- reply readiness score

This explains why community-building cards can still crowd the channel even when they are not strategically useful.

### 3. Classifier Policy Is Internally Conflicted On Emoji

`packages/core/src/ai/classifier.ts` says emoji reactions from real users can be `community_building`, but also says emoji-only or very short reactions should be skipped if too low-effort.

That may be directionally right, but production behavior suggests the threshold is still too permissive for Jay's desired workflow.

### 4. Retrieval For Hard Questions Is Still A Bottleneck

Narrative retrieval is tied to `counter_arguments` plus the classifier's narrative topic. If topic tags are missing or similarity falls below threshold, hard questions skip with `no_relevant_knowledge`.

That creates the worst possible split:

- low-value community comments get Slack cards
- high-value hard questions become knowledge gaps

### 5. Existing Docs Already Identify The Same Root Issue

`docs/ig-bot-build-plan.md` and `docs/pipeline-issue-report-2026-04-29.md` already call out:

- rejected examples are not operationalized
- narrative knowledge retrieval is too strict
- topic tagging and fallback retrieval are needed
- negative feedback should become skip/routing logic

The next step is implementation, not more strategy.

## Build Plan

## Implementation Status

Implemented on 2026-05-22:

- Negative feedback retrieval now runs next to positive example retrieval.
- High-similarity rejected examples with reason `should_not_reply` now skip similar future comments before generation.
- Softer rejected examples now go into the generator prompt as "avoid repeating these mistakes" examples.
- Allocation now ranks `narrative_shaping` before `informational` before `community_building`.
- Allocation filters emoji-only, short generic praise, and teacher-giveaway grade/subject entries.
- Slack review cards now show why a card was surfaced: score, signals, knowledge strength, approved example strength, and rejected-example warnings.
- A dry-run-first stale Slack review reset script was added. It retires old pending DB records without deleting or editing Slack messages.
- Slack approve/edit/reject handlers now ignore actions for replies that are no longer pending.
- Pure-function evals were added for allocation, learned skip matching, generator prompt negative examples, and Slack card metadata.

### What Jay Should See

Low-value community comment:

```text
Comment: "👏👏👏"
Prior behavior: Slack card with a generic warm reply.
New behavior: filtered before Slack, or skipped if a similar prior rejection was marked should_not_reply.
```

Teacher giveaway entry:

```text
Comment: "3rd grade math"
Post: "Teacher giveaway: comment your grade or subject..."
Prior behavior: Slack card with a thank-you reply.
New behavior: filtered before Slack as giveaway_entry/low-value community.
```

Hard narrative comment:

```text
Comment: "AI cannot replace a real teacher for kids who need human connection."
New behavior: ranked above community replies, retrieves counter-argument knowledge, and sends a Slack card with a grounded draft plus why-surfaced metadata.
```

Rejected-pattern learning:

```text
Jay rejects a draft as should_not_reply.
Future similar comment reaches retrieval.
If similarity is high enough, the bot sets skipReason = learned_should_not_reply and no Slack card is created.
If similarity is related but not a hard skip, the rejected example is shown to the generator as something to avoid.
```

### P0: Make Jay's Rejections Operational

Goal: If Jay rejects a reply as `should_not_reply`, similar comments should stop appearing as Slack cards.

Implementation:

- Add negative example retrieval alongside positive example retrieval.
- Include reject reason and notes in `ExampleResult`.
- Add a pre-generation routing check:
  - if similar negative example is high similarity and reason is `should_not_reply`, mark `comments.skipReason = learned_should_not_reply`.
  - record pipeline event `learned_negative_feedback_match`.
- If generation continues, pass similar rejected examples into the generator prompt as avoidance examples.

Eval:

- Add a fixture where a sarcastic/low-value/emoji-style comment resembles a rejected example and should be skipped.
- Add a fixture where a similar but substantive hard question should not be skipped.

### P1: Reduce Fluff In Slack

Goal: Jay should see fewer low-leverage community-building suggestions.

Implementation:

- Add deterministic pre-filter for low-effort comments:
  - emoji-only
  - short praise under a configurable token/character threshold
  - giveaway entries like grade/subject-only unless they contain a question or useful community signal
- Add category caps inside allocation:
  - reserve a fixed minimum for `narrative_shaping`
  - reserve a fixed minimum for `informational`
  - cap `community_building` unless Slack volume is otherwise low
- Add a `replyReadinessScore` or equivalent deterministic rank:
  - topic priority
  - visibility
  - knowledge strength
  - positive similarity boost
  - negative similarity penalty
  - low-effort penalty

Eval:

- Allocation eval with a mixed pool: emoji/praise, teacher giveaway, hard AI objection, screen-time objection, location question.
- Expected result: hard/narrative/informational comments outrank low-value community comments.

### P1: Improve Hard-Question Coverage

Goal: The bot should draft more useful responses for recurring AI/screen-time/traditional-school objections.

Implementation:

- Add fallback retrieval for narrative comments:
  1. `counter_arguments + narrativeTopic`
  2. all `counter_arguments`
  3. similar prior manual IG replies
  4. skip only if still weak
- Backfill or infer narrative topic tags for existing counter-argument knowledge.
- Use prior Instagram owner replies as high-weight source material for the exact objections Jay/MacKenzie already answered.

Eval:

- Retrieval eval by topic:
  - AI replacing teachers
  - screen time/laptops
  - socialization/human connection
  - traditional school comparison
  - neurodivergent / struggling learners
  - cost/elitism
- For each case, assert relevant knowledge is retrieved or the system explicitly skips with a useful knowledge-gap reason.

### P1: Make The Slack Channel More Useful

Goal: The channel should help Jay train faster and see why the bot chose each item.

Implementation:

- Add "why surfaced" metadata to Slack cards:
  - topic
  - visibility score
  - retrieved knowledge strength
  - similar approved examples
  - similar rejected warnings
- Add "low leverage" or "would skip next time" handling for rejections.
- Show whether approval posts to Instagram or only stores training, depending on current deployment mode.

Eval:

- Snapshot/block test for Slack message payloads.
- Ensure the card includes enough metadata for Jay to understand selection without opening code/logs.

### P2: Add Feedback Metrics

Goal: Prove the bot is learning from Jay.

Metrics:

- approval rate by classification group
- rejection rate by reason
- edit rate by category
- percent of Slack cards that are narrative/informational vs low-value community
- learned-skip count
- repeated rejection clusters
- no-knowledge gaps by topic
- retrieval coverage by topic

## Eval Suite To Add

### 1. Classification Eval

Current eval exists, but accuracy was last recorded at about 69% on reviewed examples. Add slices:

- emoji/fluff should skip
- giveaway entries should mostly skip unless a question/relationship signal exists
- hard objections should be narrative
- location/program questions should be informational
- hostile but substantive criticism should not be deleted

### 2. Allocation Eval

New deterministic test around `allocateReplies`.

Expected behavior:

- narrative > informational > community when daily budget is tight
- low-effort community examples are filtered or heavily penalized
- comments similar to rejected `should_not_reply` examples are skipped
- high-like narrative comments outrank low-like community praise

### 3. Retrieval Eval

Test `retrieveForComment` behavior with seeded in-memory/fake examples where possible:

- topic-specific retrieval works
- fallback retrieval works when topic tags are missing
- prior manual IG replies are retrieved as examples
- no-knowledge skip happens only after fallback fails

### 4. Generator Eval

Pairwise judge is useful, but add rule-based assertions:

- no unsupported facts
- no repetitive emoji-only reply unless explicitly allowed
- no generic "so glad you liked it" on a hard question
- reply addresses the specific claim
- for informational questions, acknowledges the actual ask before routing to DM/bio

### 5. Feedback Loop Eval

The highest-priority new eval.

Fixture:

1. Seed a negative `responseExamples` row with `reviewReason = should_not_reply`.
2. Process a similar new comment.
3. Assert it is skipped before generation or receives a negative warning.

Fixture:

1. Seed an edited example.
2. Process a similar new comment.
3. Assert the edited positive version is retrieved and the rejected original is used as an avoidance pattern.

### 6. Slack Digest Eval

Digest should report:

- pending review count
- low-value community count
- learned skips
- knowledge gaps by unique comments, not just event count
- approval/edit/rejection trend
- posting mode

## Computer Use Plan

Computer Use can help, but it should be used carefully because Slack actions can mutate state and approving could eventually publish to Instagram depending on deployment mode.

Safe uses:

- Read the live `#foe-bot` channel visually to inspect card usability.
- Inspect Slack modals and card layout after local/staging changes if a safe test channel exists.
- Compare live Instagram comment threads against what the bot selected.
- Verify whether the Slack UI makes "approve posts to Instagram" clear.

Do not do without explicit confirmation:

- Click Approve/Edit/Reject on live `#foe-bot`.
- Post or delete Instagram comments.
- Change Slack app settings or production env settings.

## Recommended Next Coding Slice

Start with a contained feedback-loop slice:

1. Extend `ExampleResult` with `reviewReason` and `reviewNotes`.
2. Add `searchExamples({ positiveOnly: false })` support that can retrieve negative examples explicitly.
3. Update `retrieveForComment` to return `positiveExamples` and `negativeExamples`.
4. Add learned-skip routing for high-similarity `should_not_reply` examples.
5. Add generator prompt section for similar rejected examples.
6. Add unit tests for negative feedback retrieval and learned skip routing.

This directly answers Jay's complaint that rejecting bad replies does not appear to affect the bot.
