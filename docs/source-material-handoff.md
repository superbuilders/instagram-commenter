# Instagram Comment Bot Source Material Handoff

This document explains what source material we collected for the Instagram comment bot, where it lives, and how it is used by the system.

## Short Answer

We did not scrape all of MacKenzie's content into one Markdown file.

Instead, the source material is stored as structured project data:

- Instagram scrape outputs are stored as JSON.
- Podcast and interview transcripts are stored as TXT files.
- Internal source conversations are stored in docs.
- Approved reply examples are stored as structured comment/reply pairs.
- Production ingestion turns these files into database knowledge chunks with embeddings.

The bot does not read one giant Markdown file at runtime. It retrieves relevant chunks and examples from the knowledge database.

## What We Collected

### Instagram Content

Location:

- `data/apify-raw/posts-raw.json`
- `data/apify-raw/scrape-metadata.json`
- `data/voice-samples/captions.json`
- `data/voice-samples/all-comments-pool.json`
- `data/voice-samples/reply-pairs.json`
- `data/voice-samples/voice-analytics.json`
- `data/voice-samples/scrape-summary.json`

Current processed counts:

- 777 Instagram posts
- 768 usable captions
- 5,382 comments
- 182 real comment/reply pairs

How this is used:

- Captions become reference material for post context and voice.
- Real comment/reply pairs become positive examples for future reply generation.
- Comment pools and eval datasets help us test classification and reply behavior.

### Podcast / Interview Transcripts

Location:

- `data/podcasts/`
- `data/podcasts/manifest.json`

Current manifest counts:

- 109 discovered podcast/video items
- 33 transcribed items
- 16 explicitly skipped items

How this is used:

- Positive MacKenzie/Alpha interviews are ingested as voice/tone or institutional context.
- Negative coverage can be ingested as counter-argument material.
- The bot should use these as reference material, not as permission to invent new facts.

### Internal Source Conversation

Location:

- `docs/MacKenzie First Conversation.txt`
- `docs/source-material.md`

How this is used:

- Product strategy context.
- Early voice and workflow guidance.
- Evaluation ideas for when the bot should reply, skip, or ask for human review.

This material should not automatically become production knowledge. Durable facts and stable preferences should be promoted into structured knowledge or prompt rules deliberately.

## Runtime Knowledge System

The runtime system stores source material in two main database tables:

- `knowledge_sources`
- `response_examples`

The ingestion code is here:

- `packages/core/src/knowledge/ingest.ts`
- `packages/core/src/knowledge/search.ts`
- `packages/functions/src/run-seed.ts`
- `packages/functions/src/auto-ingest.ts`

Source material can be tagged as:

- `counter_arguments`
- `voice_tone`
- `institutional`
- `deletion_guidelines`
- `messaging_boundaries`

At generation time, the bot retrieves relevant material based on the comment type:

- Narrative comments look for `counter_arguments`.
- Informational comments look for `institutional` knowledge.
- Similar approved replies are retrieved as voice examples.

## Style Guide / Brand Voice

There is not currently a standalone Markdown style guide that the bot reads live.

The active voice rules are hardcoded in:

- `packages/core/src/ai/generator.ts`

Those rules were derived from analysis of real replies and source material. They include guidance like:

- Warm, genuine, confident, but not defensive.
- Use first-person plural for Alpha: "we", "our students", "our guides".
- Stay direct and succinct.
- Do not overuse emoji.
- Do not sound like a generic FAQ bot.
- Do not make factual claims unless grounded in retrieved knowledge.

Additional voice comes from:

- Real scraped reply pairs in `data/voice-samples/reply-pairs.json`.
- Slack-approved replies.
- Slack-edited replies.

## Karpathy-Style Feedback Loop

The current loop captures human feedback:

1. The bot drafts a reply.
2. The reply goes to Slack.
3. Jay/team approve, edit, or reject.
4. The decision is stored on the reply.
5. The example is embedded into `response_examples`.

Implemented:

- Approved replies become positive examples.
- Edited replies store the original as a negative example and the edited reply as a positive example.
- Rejected replies are stored with rejection reason and notes.

Not fully implemented yet:

- Rejected examples do not yet strongly prevent similar comments from being selected in the future.
- Negative feedback is not yet used as a pre-generation routing filter.
- The weekly improvement loop is not yet fully automated.

So the current system has the feedback data layer, but the next step is making that feedback operationally change routing, ranking, and generation.

## Suggested Review Packet

For someone reviewing the source material and bot design, share these files first:

- `docs/source-material-handoff.md`
- `docs/ig-bot-build-plan.md`
- `docs/system-architecture.md`
- `docs/source-material.md`
- `docs/MacKenzie First Conversation.txt`
- `data/voice-samples/scrape-summary.json`
- `data/voice-samples/voice-analytics.json`
- `data/voice-samples/reply-pairs.json`
- `data/voice-samples/captions.json`
- `data/podcasts/manifest.json`
- `docs/pipeline-issue-report-2026-04-29.md`

Only share the full raw scrape if they need to audit the underlying Instagram data:

- `data/apify-raw/posts-raw.json`
- `data/voice-samples/all-comments-pool.json`

Those files are larger and less reviewer-friendly.

## Suggested Explanation To Send

We did not put everything into one Markdown file. The project has a structured source-material system. Instagram data is in JSON, podcast/interview transcripts are in TXT files, and internal source conversations are in docs. When the bot is seeded, this material is chunked, embedded, and stored in the database as knowledge sources and response examples. The active style guide is currently embedded in the generator prompt, while real approved/edited replies are retrieved dynamically as examples. The feedback loop captures approvals, edits, and rejections, but the next build step is making rejected examples actively affect future routing.

