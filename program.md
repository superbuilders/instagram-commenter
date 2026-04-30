# Research Program: Improve Instagram Comment Selection

## Goal

Improve which Instagram comments are surfaced to Slack for Jay's review.

The system should use the limited daily Slack budget on comments that are actually worth human attention: high-value narrative moments, meaningful community engagement, and answerable informational questions. It should suppress low-effort reactions, sarcasm/bait, comments that do not need a response, and comments where the bot lacks enough knowledge to answer safely.

This is the first autoresearch loop because comment selection quality controls everything downstream. If the system sends Jay weak comments, generation and verification improvements will not solve the core workflow problem.

## Current Baseline

The current production pipeline is:

```txt
comment ingestion
  -> classification
  -> basic allocation by classification group and likes
  -> knowledge retrieval
  -> reply generation
  -> verification
  -> Slack review
  -> Jay approves/edits/rejects
```

The current allocation score is mostly:

```txt
narrative_shaping before community_building before informational
then sort by likes
```

Jay's Slack actions are stored, but rejected examples are not yet strongly used to reduce future bad selections.

## Target Files

Initial target files:

- `packages/core/src/ai/classifier.ts`
- `packages/core/src/scheduling/allocator.ts`
- `packages/core/src/knowledge/search.ts`
- `packages/functions/src/allocate-replies.ts`
- future eval scripts under `scripts/`

Do not modify posting or deletion behavior as part of this research loop.

## Experiment Command

Initial command to create:

```bash
pnpm eval:comment-selection
```

This command should run the current classifier/ranker/retrieval logic against a frozen historical dataset and output a JSON metrics summary.

Until that command exists, the first implementation step is to add:

- a dataset export script from production feedback
- a local fixture file for reviewed comments
- an eval runner that compares candidate routing decisions to Jay's approve/edit/reject labels

## Success Metrics

Primary metrics:

- Increase precision of the top daily Slack candidates.
- Reduce `should_not_reply` rejections.
- Reduce low-effort comments surfaced to Slack.
- Preserve high-value narrative comments.

Secondary metrics:

- Reduce `no_relevant_knowledge` candidates selected for generation.
- Increase approval-without-edit rate.
- Reduce repeated rejection clusters.
- Improve shadow `would_auto_send` precision once shadow labels exist.

Guardrail metrics:

- Do not reduce recall for important narrative topics like screen time, AI education, traditional school, socialization, field trips, and teacher/guide concerns.
- Do not increase unsupported factual claims.
- Do not auto-send anything from this loop until shadow testing proves safety.

## Desired Scoring Direction

Move from basic allocation to a reply readiness score:

```txt
reply_readiness_score =
  topic_priority
  + visibility_score
  + knowledge_strength
  + approved_similarity_boost
  - rejected_similarity_penalty
  - low_effort_penalty
  - sarcasm_or_bait_penalty
  - unsupported_claim_risk
```

Initial output decision:

```txt
skip
send_to_slack
would_auto_send
auto_send
```

For now, `would_auto_send` must be shadow-only and `auto_send` must remain disabled.

## Constraints

- Keep Jay in the loop for all real replies.
- Do not enable production auto-send.
- Do not modify comment deletion behavior.
- Prefer rule-based scoring first so decisions are inspectable.
- Every scoring decision should include reasons that can be shown in Slack or diagnostics.
- Use Jay's approve/edit/reject data as labels.
- Treat rejected examples as avoidance signals, especially `should_not_reply`.
- Keep experiments reproducible against a frozen dataset.

## Experiment Log

| # | Change | Metric Before | Metric After | Kept? |
|---|--------|---------------|--------------|-------|
