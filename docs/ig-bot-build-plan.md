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

### 6. Posting Mode Is Ambiguous

Approved replies can be posted if the posting cron is enabled, but posting is separately controlled.

Impact:

- A reviewer may think approval posts to IG, while production may only mark the reply approved.
- Or the opposite: enabling the cron could start posting approved replies.

Fix:

- Make operating mode explicit in Slack:
  - `Review only`
  - `Approve and post`
- Add this mode to the daily digest.

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
