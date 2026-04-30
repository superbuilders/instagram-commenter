# Instagram Comment Bot Reviewer Handoff

## Executive Summary

We are building an Instagram comment assistant for MacKenzie Price / Future of Education. The goal is not to make a generic auto-reply bot. The goal is to create a reliable human-in-the-loop system that helps the team notice the highest-leverage comments, draft high-quality responses in MacKenzie's voice, route questionable items for review, and improve over time based on the team's approvals, edits, and rejections.

The core product bet is that Instagram comments are not just inbox noise. They are public narrative surfaces. A highly liked comment about "too much screen time," "AI replacing teachers," or "kids need real socialization" can shape how thousands of people understand Alpha School unless the team responds thoughtfully. The bot should make sure those moments are surfaced and handled with the right knowledge, tone, and restraint.

The system should be conservative. It should prefer skipping or asking for review over making unsupported claims. Slack approval remains the operating control layer.

## What We Are Trying To Achieve

The bot should do five jobs well:

1. **Awareness:** Identify important comments that would otherwise be missed, especially after high-volume periods or operational pauses.
2. **Prioritization:** Focus attention on the comments with the most public leverage, not every comment.
3. **Grounded drafting:** Generate replies using approved knowledge and MacKenzie's observed voice, without inventing facts.
4. **Human review:** Put every proposed reply in Slack with enough context for a human to approve, edit, reject, or eventually post.
5. **Learning loop:** Convert every human decision into structured feedback that improves future routing and generation.

## What The Bot Should Reply To

- Narrative shaping: visible comments that challenge Alpha, 2 Hour Learning, AI learning, screen time, teachers, traditional school, or related public narratives.
- Community building: warm replies to supporters, parents, students, and real community moments.
- Informational: factual questions about locations, admissions, programs, cost, schedule, and next steps.
- Deletion review: spam, pure trolling, or bad-faith comments that may need removal.

## What The Bot Should Not Do

- It should not auto-reply to everything.
- It should not debate people who are being sarcastic, baiting, dismissive, or not actually asking for engagement.
- It should not answer factual questions without retrieved knowledge.
- It should not invent statistics, locations, program claims, student details, or policy positions.
- It should not delete comments without explicit human-approved operating mode.
- It should not treat one approved reply as permission to auto-post future similar replies without review until the system is proven.

## Operating Principle: The Karpathy Loop

We want a practical version of the "Karpathy loop":

1. The model makes a prediction or draft.
2. A human reviews the output in the real workflow.
3. The human's correction is captured as structured data.
4. The system uses that data to improve future behavior.
5. The improved behavior is measured with evals and production feedback.

For this bot, the loop is:

```txt
Instagram comment
  -> classification
  -> knowledge retrieval
  -> generated reply or skip
  -> Slack review
  -> approve / edit / reject
  -> store feedback
  -> retrieve feedback on future similar comments
  -> update evals and prompts
```

The important requirement is that feedback must not only be stored. It must actively affect future behavior.

Examples:

- If a reply is approved, similar future comments can use it as a positive voice/style example.
- If a reply is edited, the original reply becomes a negative example and the edited reply becomes a positive example.
- If a reply is rejected as `should_not_reply`, similar future comments should be skipped before generation or shown with a warning.
- If a reply is rejected as `factually_risky`, future generation should either retrieve stronger knowledge or skip.
- If repeated comments are skipped for `no_relevant_knowledge`, the system should create a knowledge gap report so the team can add the missing talking points.

## Reviewer Focus

When reviewing this system, focus on whether the code supports the product loop above:

- Are we ingesting enough comments to avoid missing important moments?
- Are we classifying comments into useful action buckets?
- Are narrative replies grounded in the right knowledge?
- Are Slack actions captured as durable training data?
- Are rejected examples used to prevent repeated mistakes?
- Are knowledge gaps visible to the team?
- Are posting/deletion modes explicit and safe?
- Are there evals that measure whether the loop is improving?

## Current Pipeline

1. Ingest comments from recent Instagram posts.
2. Classify each comment as `narrative_shaping`, `community_building`, `informational`, `delete`, or `skip`.
3. Allocate a limited daily set of comments for reply generation.
4. Retrieve knowledge and similar reply examples.
5. Generate a proposed reply.
6. Verify that specific factual claims are grounded.
7. Send the proposed reply to Slack.
8. Human approves, edits, or rejects.
9. Feedback is stored for future learning.
10. If posting is enabled, approved replies are posted back to Instagram.

## Current Pre-Jay Decision System

Jay only sees the end of a longer decision pipeline. The important product point is that Slack is the review surface, not the whole bot. The bot already makes several decisions before anything reaches Jay.

Current pre-Jay flow:

```txt
Instagram post/comment ingestion
  -> classify comment
  -> exclude skips and deleted/non-actionable comments
  -> rank candidates inside the daily budget
  -> retrieve relevant knowledge and prior examples
  -> generate a draft reply
  -> verify factual grounding
  -> create pending reply
  -> send Slack card to Jay
```

What currently happens well:

- Comments are classified before Slack.
- Low-effort reactions can now be skipped by the classifier.
- Narrative/informational replies require relevant knowledge before generation.
- Generated replies go through a verifier before Slack.
- Jay's approve/edit/reject decision is stored on the reply.
- Approved, edited, and rejected examples can be stored as response examples.

What is still basic:

- Ranking is mostly classification priority plus comment likes.
- Confidence shown in Slack is classifier confidence, not a full auto-send readiness score.
- Rejected examples are stored, but not yet used strongly to suppress similar future comments.
- Edited replies are stored as positive examples, but not yet used as a formal eval target.
- There is no explicit `would_auto_send` shadow decision yet.
- The system does not yet have a promotion gate that says "this version is measurably better than the previous one."

## Human-In-The-Loop Now, Auto-Send Later

The architecture should treat Jay as the current approval policy. That makes auto-send a later policy change, not a rewrite.

Today:

```txt
approval policy = send every viable generated reply to Slack
```

Later:

```txt
approval policy =
  auto_send if confidence is very high and risk is very low
  send_to_slack if useful but uncertain
  skip if low-value, risky, unsupported, or not worth engagement
```

This means every reply candidate should eventually receive a routing decision:

- `skip`
- `send_to_slack`
- `hold_for_review`
- `would_auto_send`
- `auto_send`

The system should support these states before auto-send is enabled. In shadow mode, the bot can mark a reply as `would_auto_send` while still sending it to Jay. If Jay approves without edits, that is evidence that the auto-send rule was correct. If Jay edits or rejects, that is evidence the rule is too permissive.

## Confidence And Ranking Should Learn From Jay

The high-confidence ranking should not remain static. It should improve from Jay's behavior.

Jay's actions should update the system like this:

- `approve`: the comment selection, retrieved knowledge, and reply were acceptable. Similar future cases should get a positive boost.
- `edit`: the comment was worth responding to, but the generated reply was imperfect. Similar future cases should still be surfaced, but generation should learn from the edited text.
- `reject / should_not_reply`: the comment should probably have been skipped. Similar future comments should get a strong negative routing signal.
- `reject / unsupported_claim`: the comment may be worth answering, but retrieval or verifier failed. Similar future cases should require stronger knowledge or stay in Slack review.
- `reject / tone`: the comment may be worth answering, but the draft voice was wrong. Similar future cases should retrieve the rejection as an avoidance example.
- `ignore/no action`: weaker signal. It may mean Slack overload, stale timing, or low priority. It should not be treated as a hard negative without additional evidence.

The ranking model should eventually combine:

- classification group
- classifier confidence
- likes and visibility
- comment recency
- author/account importance
- narrative topic priority
- knowledge retrieval strength
- verifier result
- similarity to approved examples
- similarity to edited examples
- similarity to rejected examples
- low-effort/sarcasm/bait signals
- topic-level historical approval rate
- post-level context

The first version does not need a trained ML model. A deterministic score is enough:

```txt
reply_readiness_score =
  topic_priority
  + visibility_score
  + knowledge_strength
  + approved_similarity_boost
  - rejected_similarity_penalty
  - low_effort_penalty
  - unsupported_claim_risk
  - sarcasm_or_bait_penalty
```

This score should control Slack prioritization first. Later, after shadow testing, it can control auto-send eligibility.

## Auto-Send Readiness Criteria

Auto-send should not be controlled by a single confidence number. It should require a bundle of gates.

A reply can only be considered for auto-send when all of these are true:

- The comment is not low-effort, sarcastic, baiting, hostile, or purely rhetorical.
- The comment belongs to an allowed auto-send category.
- The topic has a strong historical approval rate.
- Similar past examples were approved or lightly edited.
- Similar rejected examples are below a strict similarity threshold.
- Retrieval found strong source material when the reply makes factual or Alpha-specific claims.
- Verification passed.
- The generated reply contains no unsupported specifics.
- The reply is short, warm, and does not escalate conflict.
- Daily and per-post auto-send caps are not exceeded.
- The operating mode explicitly allows auto-send.

Initial allowed auto-send categories should be narrow. Good candidates:

- simple warm replies to clearly supportive comments
- factual informational replies with exact approved source material
- repeated low-risk community replies that Jay has historically approved

Poor initial auto-send categories:

- screen-time debates
- AI replacing teachers
- skeptical parent objections
- sarcasm or dunking
- anything involving student outcomes, cost, locations, or program promises without fresh source material
- deletion decisions

## Shadow Auto-Send Phase

Before actual auto-send, add shadow mode.

In shadow mode:

```txt
bot computes auto-send decision
bot still sends the reply to Slack
Slack card shows "Would auto-send: yes/no" and why
Jay approves/edits/rejects as usual
system compares Jay's action against the shadow decision
```

Success metrics:

- `would_auto_send` approval rate
- `would_auto_send` edit rate
- `would_auto_send` rejection rate
- false positive auto-send candidates
- approval rate by topic
- approval rate by source type
- approval rate by similar-feedback cluster

Promotion rule:

```txt
Do not enable real auto-send until shadow auto-send candidates are approved without edits at a consistently high rate, with zero severe safety misses.
```

## How The Karpathy Loop Fits

The Karpathy-style loop is the improvement engine around the production bot.

Production loop:

```txt
comment -> classify -> retrieve -> generate -> verify -> Slack -> Jay decision
```

Autoresearch loop:

```txt
Jay decisions -> eval dataset -> try a change -> run eval -> compare metrics -> keep or discard -> deploy
```

The production bot should keep running conservatively. The autoresearch loop should run offline or in shadow mode against fixed historical examples. It should not blindly mutate production behavior.

The first research programs should be:

1. **Comment Selection Research**
   - Goal: improve which comments are surfaced to Jay.
   - Primary metric: higher precision in the daily Slack budget.
   - Failure metric: missed high-value narrative comments.

2. **Knowledge Retrieval Research**
   - Goal: retrieve the right Alpha/source material for the comment.
   - Primary metric: fewer `no_relevant_knowledge` skips for topics where knowledge exists.
   - Failure metric: more unsupported claims or generic replies.

3. **Reply Quality Research**
   - Goal: generate replies Jay approves with fewer edits.
   - Primary metric: higher approve-without-edit rate.
   - Failure metric: more tone, accuracy, or should-not-reply rejections.

4. **Auto-Send Readiness Research**
   - Goal: predict which replies Jay would approve without edits.
   - Primary metric: shadow auto-send precision.
   - Failure metric: any rejected `would_auto_send` reply that would have been risky in public.

## Concrete Build Plan For The Learning System

### Step 1: Build The Feedback Dataset

Export a durable dataset that joins:

- comment text
- post caption
- author username
- likes
- classification group
- narrative topic
- retrieved knowledge IDs and similarity scores
- generated reply
- verifier result
- Slack outcome
- edit text, if edited
- reject reason and notes, if rejected
- timestamps

This dataset becomes the source for evals and autoresearch.

### Step 2: Add Negative Feedback Retrieval

Change retrieval so each candidate gets:

- similar approved examples
- similar edited examples
- similar rejected examples

Rejected examples must be available before generation so routing can skip comments that look like prior `should_not_reply` cases.

### Step 3: Add A Reply Readiness Score

Introduce a single structured scoring object:

```ts
type ReplyReadiness = {
  decision: "skip" | "send_to_slack" | "would_auto_send" | "auto_send";
  score: number;
  reasons: string[];
  risks: string[];
  evidence: {
    approvedExampleIds: string[];
    rejectedExampleIds: string[];
    knowledgeSourceIds: string[];
  };
};
```

At first this should be rule-based and logged only. Then it should control Slack ranking. Only later should it control auto-send.

### Step 4: Add Shadow Auto-Send Labels To Slack

Slack cards should eventually show:

- why this comment was selected
- strongest knowledge source
- similar approved example, if any
- similar rejected warning, if any
- `would_auto_send` decision and reasons

This makes Jay's review more informative and creates better data.

### Step 5: Add Offline Evals

Create evals for:

- comment routing: should reply vs should skip
- topic tagging
- knowledge retrieval hit rate
- reply quality
- verifier correctness
- auto-send readiness

The evals should run against frozen historical examples before deployment.

### Step 6: Add The Autoresearch Program

Create a `program.md` for one narrow research question at a time. The first one should focus on comment selection quality because bad selection wastes Jay's attention and makes every downstream metric worse.

The loop:

```txt
read program.md
modify classifier/ranker/retrieval prompt or config
run eval command
compare score to baseline
keep only if improved
log experiment
```

### Step 7: Promote In Stages

Promotion path:

1. Human-review only.
2. Shadow scoring.
3. Shadow auto-send.
4. Limited auto-send for safest categories.
5. Expanded auto-send after topic-specific evidence.

At every stage, Jay's feedback remains useful. Even after auto-send is enabled, sampled auto-sent replies should still be reviewed so the system does not drift.

## Slack Feedback: What Gets Saved

When a Slack reviewer rejects a reply, the modal captures:

- Reject reason, such as `should_not_reply`.
- Optional reviewer notes.
- Reply ID.
- Comment ID through the modal metadata.
- Reviewer username from Slack.

The rejection is stored in two places.

### `replies`

The original reply row is updated:

- `approvalStatus = rejected`
- `reviewOutcomeReason = rejectReason`
- `reviewOutcomeCategory = getReviewOutcomeCategory(rejectReason)`
- `reviewOutcomeNotes = rejectNotes`

This creates the durable human review record for that generated reply.

Example for the screenshot:

- `reviewOutcomeReason`: `should_not_reply`
- `reviewOutcomeCategory`: `routing`
- `reviewOutcomeNotes`: `The person is writing a sarcastic comment and downplaying what a kid has done...`

### `response_examples`

The rejected reply is also inserted as a negative response example:

- `commentText`: original IG comment
- `responseText`: generated reply that was rejected
- `isPositive = false`
- `source = slack_rejected`
- `classificationGroup`: the comment's classification
- `reviewReason`: reject reason
- `reviewNotes`: reviewer notes
- `originalReplyId`: reply ID
- `policyVersion`: current classifier policy version
- `embedding`: vector embedding of `Comment + Response`

This means the system has the rejection data needed to learn.

## Current Feedback Learning Gap

The code currently stores rejected examples, but generation only retrieves positive examples:

```ts
searchExamples(commentText, {
  classificationGroup,
  positiveOnly: true,
  limit: 3,
  minSimilarity: 0.3,
})
```

That means the bot can learn from approved and edited replies as positive style examples, but it does not yet use rejected examples to avoid bad behavior.

For the screenshot case, the feedback is saved, but the generator is not yet being told:

> Similar past comment was rejected because it was sarcastic/downplaying and should not receive a reply.

The next build step should make negative feedback operational.

## Feedback Learning Improvements

The feedback loop should be treated as product-critical infrastructure. Slack review is not only a safety gate; it is the data-labeling interface for the bot. Every button click and note should either improve routing, improve generation, expose a knowledge gap, or become an eval case.

### 1. Retrieve Negative Examples

For every candidate comment, retrieve both:

- Similar positive examples for voice and style.
- Similar negative examples for avoidance and routing.

Negative examples should include:

- rejected generated reply
- reject reason
- reject notes
- classification group
- similarity score

### 2. Use Negative Examples Before Generation

Before generating, run a lightweight routing check:

- Does this comment resemble past `should_not_reply` examples?
- Does it look sarcastic, dismissive, baiting, or not actually asking for engagement?
- Is the best action to skip instead of draft?

If yes, set:

- `comments.skipReason = learned_should_not_reply`
- pipeline event `reasonCode = learned_negative_feedback_match`

This prevents Slack from seeing the same kind of bad suggestion repeatedly.

### 3. Add Negative Examples to Generator Prompt

If the comment is still worth generating for, pass negative examples into the prompt:

```txt
SIMILAR REJECTED REPLIES:
- Comment: "..."
  Rejected reply: "..."
  Reason: should_not_reply
  Notes: "Sarcastic comment, not needing a response."

Avoid repeating these mistakes.
```

### 4. Turn Rejections Into Eval Cases

Rejected replies with useful notes should become eval rows. For the screenshot, an eval case should say:

- Input comment: sarcastic/downplaying comment.
- Expected behavior: `skip`.
- Gold reason: `should_not_reply`.

This trains the classifier/routing layer, not just the generator.

### 5. Add Feedback Metrics

The system should report whether feedback is improving outcomes:

- Rejection rate by classification group.
- Top rejection reasons.
- Edit rate by classification group.
- Repeat rejection clusters, such as many `should_not_reply` rejections for sarcastic comments.
- Number of comments skipped because they matched prior negative feedback.
- Number of generated replies using positive examples.
- Number of generated replies warned by negative examples.

### 6. Acceptance Criteria For The Learning Loop

The Karpathy-style loop is not complete until all of these are true:

- A rejected Slack reply is saved with reason and notes.
- The rejected reply is embedded as a negative example.
- Similar future comments retrieve that negative example.
- Routing can skip a similar future comment before generation.
- If generation still happens, the prompt includes the negative example as an avoidance pattern.
- Rejections with clear notes can be promoted into eval cases.
- A weekly report shows whether rejection/edit rates are improving.

In the current codebase, the first two are implemented. The remaining items are the core feedback-loop work still to build.

## Product Issues Found In Code Sweep

### 1. Narrative Knowledge Retrieval Is Too Strict

Narrative retrieval currently requires both:

- `brainliftType = counter_arguments`
- `narrativeTopics` contains the classifier's topic, such as `screen_time`

The issue: most ingestion paths do not populate `narrativeTopics`.

Impact:

- The bot can have relevant counter-argument knowledge but fail to retrieve it.
- Screen-time comments can be skipped with `no_relevant_knowledge`.
- Narrative replies become underpowered, especially for hot topics like laptops/screens.

Fix:

- Add topic tagging during ingestion.
- Add fallback retrieval:
  - First search `counter_arguments + topic`.
  - If empty, search all `counter_arguments`.
  - If still empty, skip.

### 2. Auto-Ingest Can Be Off While Comment Processing Is On

Comment crons and auto-ingest are controlled by separate flags.

Impact:

- The bot may keep classifying and allocating comments while WorkFlowy, Substack, website, captions, and manual reply knowledge are not refreshing.
- Knowledge silently becomes stale.

Fix:

- Include auto-ingest in the normal comment-bot deployment mode, or alert in Slack when it is disabled.
- Add a digest field: `Knowledge sync: last successful run`.

### 3. Catch-Up Ingestion Is Weak

Instagram ingestion fetches recent media and a capped number of comment pages.

Impact:

- After a pause or high-volume spike, older missed comments may fall out of the fetch window.
- A week-long gap can leave comments unseen unless manually recovered.

Fix:

- Add catch-up mode by date range and known post IDs.
- Continue pagination until no new comments or a configured cutoff.
- Report ingestion coverage in Slack.

### 4. Classification Throughput Can Fall Behind

Classification uses a fixed small batch size.

Impact:

- High-volume periods can create backlog.
- The bot may look "paused" even when crons are technically running.

Fix:

- Loop batches until timeout.
- Use dynamic batch size.
- Add backlog counts to digest.

### 5. Budget Tracks Allocation More Than Awareness

The budget currently counts allocated/generated Slack candidates more than successful human awareness.

Impact:

- A day can appear budgeted out even if many items skipped, failed, or were not meaningfully surfaced.

Fix:

Track separate counters:

- selected
- retrieved
- generated
- sent_to_slack
- approved
- edited
- rejected
- posted
- skipped_no_knowledge

Use `sent_to_slack` as the awareness metric.

### 6. Posting Mode Must Match Jay's Mental Model

Approving a Slack reply does not directly call Instagram. The Slack action updates the reply row to `approvalStatus = approved`. A separate `PostReplies` cron looks for approved, unposted replies and posts them to Instagram.

That means current behavior depends on whether `ENABLE_POST_REPLY_CRON` was enabled at deploy time:

- If `PostReplies` is disabled, Jay clicking approve only stores approval and training feedback. Nothing is posted.
- If `PostReplies` is enabled, Jay clicking approve queues the reply for the posting worker, which can post it on the next cron run.

This is human-approved posting, not auto-send. Auto-send would be different: the system would mark a reply `auto` or otherwise eligible for posting without Jay clicking approve.

The desired product behavior is:

```txt
Jay clicks Approve -> reply is approved -> reply is posted to Instagram automatically
```

In other words, Jay's approval should mean "approved to publish," not merely "approved as training feedback."

Impact:

- A reviewer may think approval posts to IG, while production may only mark the reply approved.
- Or the opposite: enabling the cron could start posting approved replies.
- If the posting cron is enabled after a period of review-only operation, old approved-but-unposted replies may post unless the backlog is cleared or filtered.

Fix:

- Treat `Approve queues post` as the normal operating mode.
- Make this mode explicit in Slack so Jay knows approval publishes the reply.
- Add this mode to the daily digest.
- Before enabling `PostReplies`, inspect approved-but-unposted backlog and either post only newly approved replies or manually clear old ones.
- Keep `Auto-send enabled` as a future mode only, manually enabled after shadow testing.

### 7. Verifier Fails Open

If verification fails due to API or parse issues, the verifier returns `verified: true`.

Impact:

- Slack may receive replies that were not actually fact-checked.

Fix:

- For `narrative_shaping` and `informational`, fail closed or send to Slack with a visible `verification_unavailable` warning.

### 8. Slack Actions Are Not Idempotent

Approve/edit/reject transitions do not currently guard against stale or repeated actions.

Impact:

- Double-clicks or old Slack messages can create duplicate examples or conflicting review state.

Fix:

- Only allow `pending -> approved/rejected`.
- If already reviewed, return a no-op and update Slack message with current state.

### 9. Auto-Delete Is Too Risky

Deletion can auto-execute for very high confidence delete classifications if deletion is enabled.

Impact:

- A classifier mistake could delete a real comment.

Fix:

- Keep all deletion human-reviewed until classifier precision is proven.
- Remove auto-delete or require a separate hard-coded production approval flag.

### 10. Admin Debug Endpoint Uses DB Password As Export Key

The missed-comments and feedback-inspect actions use the DB password as the admin key.

Impact:

- Admin access is coupled to infrastructure credentials.
- Rotating or sharing operational access is harder.

Fix:

- Add a separate `AdminApiKey` secret.
- Keep DB password only for DB connection.

## Recommended Build Order

### Phase 1: Make Current Behavior Observable

- Add knowledge audit endpoint/report.
- Add missed comment counts by stage.
- Add digest fields for:
  - unclassified backlog
  - no-knowledge skips by topic
  - auto-ingest last run
  - pending Slack reviews
  - posting mode

### Phase 2: Fix Narrative Knowledge

- Add topic tagging during ingestion.
- Add retrieval fallback.
- Create explicit counter-argument source material for:
  - screen time/laptops
  - AI replacing teachers
  - socialization
  - cheating/jailbreak concerns
  - traditional school pushback
  - affordability/elitism

### Phase 3: Make Feedback Actually Train Behavior

- Retrieve negative examples.
- Add learned skip routing.
- Add rejected examples to eval cases.
- Add dashboard/report of top reject reasons.

### Phase 4: Harden Ops

- Add catch-up ingestion.
- Increase classifier throughput.
- Make Slack transitions idempotent.
- Separate admin key from DB password.
- Make posting/deletion modes explicit and visible.

### Phase 5: Improve Quality Loop

- Weekly eval should include:
  - classification accuracy
  - reply quality
  - rejection rate
  - edit rate
  - no-knowledge rate
  - learned-skip precision

The goal is not just more replies. The goal is fewer bad suggestions, better surfaced opportunities, and a knowledge system that improves as the team gives feedback.
