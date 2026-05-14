# Instagram Smart Commenter — Implementation Plan

## Account: @futureof_education (1M+ followers, 350M+ organic views)
## Meta App: Mackenzie Price CommentManager (App ID: 929955626406260)

---

## Mission & Purpose

This bot impersonates MacKenzie Price in Instagram comments. Getting it wrong could hurt the brand — getting it right amplifies her impact across 4,500+ comments/month.

### Three Pillars

**#1 — Narrative Shaping (highest priority)**
Top comments get thousands of likes → tens of thousands of people see them. MacKenzie must weigh in on high-visibility threads to address legitimate concerns and counter misinformation. Current hot narratives:
- "Research shows screen time is bad — Sweden outlawed it — it hurts learning"
- "AI is awful and ruining kids' brains and the environment"

MacKenzie is great at this — succinct, not overly emotional, backed by up-to-date knowledge. The bot extends her reach.

**#2 — Community Building**
Personal touch from MacKenzie: fun, lighthearted, applause emoji, encouragement, laughing emoji, commiserating with fellow parents about the school system, answering casual questions ("where'd you get those boots?", "are you speaking at X conference?"), thanking loyal followers. Her followers are thrilled when they get a comment back.

**#3 — Informational Responses**
Enrollment questions, location inquiries, program details, schedule questions, and other factual requests that come in via comments. The bot responds with accurate, up-to-date information pulled from the Institutional Knowledge BrainLift. This reduces load on the DM team (Mary handles 100+ people/day) and gives followers instant answers in-thread. For complex or sensitive inquiries, the bot directs them to DMs.

---

## Team & Roles

| Person | Role | Bot Relationship |
|--------|------|------------------|
| **Jay Lyons** | Social media manager (7 Lyons Media). Built the account from scratch. In comments daily. | Primary approver. Provides deletion parameters and narrative guidance. |
| **Juliana Lyons** | Comments team. Also responds regularly. | Secondary approver. |
| **MacKenzie Price** | Brand voice / face of @futureof_education. | Voice source for training. NOT the day-to-day approver. |
| **Mary** | DM handler (100+ people/day for enrollment, info, etc.) | Comment bot handles common info questions in-thread, reducing DM volume. Complex inquiries still route to Mary via DMs. |

---

## How It Works (Technical Explainer for Stakeholders)

The bot uses Instagram's **official Graph API** — the same system that powers tools like Hootsuite, Later, and ManyChat. Here's the flow:

1. **One-time setup**: MacKenzie logs into Meta via a secure OAuth screen (like "Sign in with Google"). This grants our app permission to read and reply to comments on her behalf. No passwords are shared with us.
2. **Permissions**: Meta reviews and approves exactly what our app can do (read comments, post replies, delete comments). We can't access DMs, post content, or do anything outside the approved scope unless we request additional permissions.
3. **How it runs**: Our system checks for new comments every few minutes, classifies them, generates replies in MacKenzie's voice, and either posts them automatically or sends them to Slack for Jay/Juliana to approve first.
4. **Token security**: The access token refreshes automatically and is stored encrypted. MacKenzie never needs to log in again unless she revokes access.

---

## How the Bot Thinks (RAG Pipeline)

The core engine is a **Retrieval-Augmented Generation (RAG)** pipeline. Instead of letting the AI improvise, every reply is grounded in real knowledge — MacKenzie's actual words, approved talking points, verified facts.

```
KNOWLEDGE BANK (Postgres + pgvector)
├── BrainLift content (synced from WorkFlowy via API, re-embedded on change)
├── IG captions + MacKenzie's replies (auto-ingested on new posts)
├── Substack posts (auto-pulled via RSS weekly)
├── Podcast transcripts (agent discovers + transcribes MacKenzie's appearances)
├── Approved bot replies (feedback loop from Slack approvals)
├── Alpha School website content (periodic scrape)
└── All embedded as 1536-dim vectors via OpenAI text-embedding-3-small

WHEN A COMMENT ARRIVES:
1. Classify → narrative_shaping | community_building | informational | delete | skip
2. If reply needed → embed the comment text
3. Similarity search against knowledge bank (cosine distance)
   - Filter by brainlift_type matching the classification
   - Boost by source_weight (BrainLift answers > general content)
   - Filter by narrative_topic if applicable
4. If top results are above confidence threshold:
   → Pass retrieved context + comment to Claude → generate grounded reply
5. If NO results above threshold:
   → SKIP — bot stays quiet, logs the gap for team review
```

**Why this matters**: The "stays quiet if it doesn't know" guardrail is built into the retrieval layer. If the similarity search finds nothing relevant, there's nothing to ground the response in — so it doesn't respond. No guessing. No improvising on sensitive topics.

**Continuous learning**: The knowledge bank grows automatically from multiple streams (see Knowledge Pipeline below). Every approved reply, every new post, every manual team response becomes future training data. The system gets smarter over time without engineering work.

---

## Knowledge Pipeline: How the Knowledge Bank Stays Current

### Automated Ingestion (no human action needed)

| Source | What It Feeds | How | Frequency |
|--------|--------------|-----|-----------|
| **WorkFlowy BrainLifts** | All knowledge types | Sync via WorkFlowy API with change detection. When team updates a BrainLift in WorkFlowy, system detects the change, re-chunks, re-embeds, and replaces old entries. | Hourly check for changes |
| **Substack posts** | Counter-Arguments + Institutional | Auto-pull via RSS feed (`futureofeducation.substack.com`), chunk by section, embed | Weekly scan for new posts |
| **Podcast transcripts** | Voice & Tone + Counter-Arguments | Long-running background script exhaustively searches YouTube/podcast platforms for MacKenzie's appearances, downloads audio, transcribes via Whisper, chunks, embeds. Runs until every appearance is accounted for, then stops. Re-run if new appearances surface. | One-time exhaustive sweep |
| **New IG posts/captions** | Voice & Tone + Institutional | When MacKenzie posts, the caption auto-ingests | Every 5 min (ingest cycle) |
| **Team's manual comment replies** | Voice & Tone (highest weight) | When Jay/Juliana/MacKenzie reply on IG, scrape those reply pairs | Daily scan |
| **Slack approval feedback** | Voice & Tone + Messaging Boundaries | Approved/rejected/edited replies feed back as training signals (see Feedback Loop below) | On each Slack action |
| **Alpha School website** | Institutional Knowledge | Periodic scrape of alpha.school | Weekly |
| **Comment trend analysis** | Gap detection | Detect emerging narratives by volume; flag topics the bot keeps skipping | Weekly digest |

### BrainLifts (via WorkFlowy)

BrainLifts are the team's knowledge documents, maintained in **WorkFlowy** (not local files). The system syncs them via the [WorkFlowy API](https://beta.workflowy.com/api-reference/), which supports change detection — when a BrainLift is updated in WorkFlowy, the system automatically re-ingests it.

| BrainLift | Owner | What Goes In | When Updated |
|-----------|-------|-------------|-------------|
| **Counter-Arguments** | MacKenzie + Jay | Talking points per narrative, sources/studies, forbidden claims | When new narratives emerge |
| **Voice & Tone** | MacKenzie | Top comment answers, tone rules, emoji patterns, banned phrases | Initial setup + refinement |
| **Institutional Knowledge** | Team | Alpha School facts, enrollment, locations, programs, expansion plans | When programs change |
| **Deletion Guidelines** | Jay | Deletion decision tree, troll patterns, criticism-that-stands examples | As patterns evolve |
| **Messaging Boundaries** | MacKenzie + Jay | Approved/forbidden claims, escalation triggers | As topics evolve |

### Feedback Loop (Slack → Knowledge Bank)

The Slack approval system uses three actions: **Approve**, **Edit**, and **Reject**. Edit opens a Slack modal pre-filled with the bot's proposed reply, allowing Jay/Juliana to modify it inline.

```
Comment arrives → Bot classifies + generates reply → Sent to Slack
       ↓
┌─────────────────────────────────────────────────────────────────┐
│ APPROVE                                                         │
│ → Post reply to Instagram                                       │
│ → Store (comment + reply) as positive training pair              │
│ → Insert into knowledge_sources with source_weight = 2.0        │
│ → Tagged by classification_group for future retrieval            │
│                                                                  │
│ EDIT (Slack modal with pre-filled text)                         │
│ → Jay/Juliana modifies the reply text in modal                  │
│ → Post EDITED version to Instagram                              │
│ → Store bot's original as negative example (don't generate this)│
│ → Store (comment + edited reply) as positive training pair      │
│ → Edited version gets source_weight = 2.5 (corrections are     │
│   the highest-value training data)                              │
│                                                                  │
│ REJECT                                                          │
│ → Do NOT post anything to Instagram                             │
│ → Store bot's reply as negative example with rejection reason   │
│ → If Jay/Juliana later replies manually on IG, the daily scan   │
│   picks up their reply and stores it as a positive pair         │
└─────────────────────────────────────────────────────────────────┘
       ↓
Over time: bot gets better, approval rate increases, team trusts it more

**Future task — turn rejection notes into classifier/routing improvements:** Slack rejections now capture both the selected reason and the free-text reviewer note. Use those notes as an explicit feedback dataset to compare the original comment, classifier output, generated reply, selected rejection reason, and reviewer explanation. The goal is to identify cases that should have been classified as `skip` / "do not reply" before allocation, update classifier prompts/evals with those examples, and eventually add a lightweight review report showing recurring rejection patterns.

HOW RELEVANCY WORKS:
When a new comment arrives, its text is embedded as a vector. The system
searches the knowledge bank by cosine similarity — finding the closest
matching approved replies, BrainLift content, and examples. Results are
filtered by classification_group and boosted by source_weight:

  source_weight 2.5 = edited corrections (highest signal)
  source_weight 2.0 = approved replies + Voice & Tone BrainLift
  source_weight 1.5 = Counter-Arguments BrainLift
  source_weight 1.0 = Institutional Knowledge, Substack, website, podcasts

The top matches become context for the generator. If nothing relevant
is found above the confidence threshold, the bot skips — never improvises.
```

### Gap Detection (what the bot doesn't know)

```
Comment classified as narrative_shaping → RAG search → no relevant results
       ↓
Bot SKIPS → logs skip reason + comment text
       ↓
Weekly digest: "15 comments about [new topic] — not enough info to respond"
       ↓
Team updates Counter-Arguments BrainLift → bot can now respond to that topic
```

---

## Repo Structure

```
instagram-commenter/
├── sst.config.ts                    # SST configuration (Lambda, EventBridge, RDS)
├── package.json
├── tsconfig.json
├── .env.example                     # Template for env vars (never commit real secrets)
│
├── packages/
│   ├── core/                        # Shared business logic
│   │   ├── src/
│   │   │   ├── db/
│   │   │   │   ├── schema.sql       # Full Postgres + pgvector schema
│   │   │   │   ├── client.ts        # Postgres connection (via pg or drizzle)
│   │   │   │   └── migrations/      # Numbered migration files
│   │   │   │
│   │   │   ├── instagram/
│   │   │   │   ├── api.ts           # Graph API wrapper (comments, replies, deletions)
│   │   │   │   ├── token.ts         # Token management (refresh, store)
│   │   │   │   └── types.ts         # IG API response types
│   │   │   │
│   │   │   ├── ai/
│   │   │   │   ├── classifier.ts    # Five-way classifier (Claude)
│   │   │   │   ├── generator.ts     # Tri-mode reply generator (Claude Sonnet)
│   │   │   │   ├── embeddings.ts    # Embed text via OpenAI embeddings API
│   │   │   │   └── prompts/
│   │   │   │       ├── classify.ts  # Classifier system prompt
│   │   │   │       ├── generate.ts  # Generator system prompt (MacKenzie voice)
│   │   │   │       ├── brainlift-loader.ts  # BrainLift content loader for generation
│   │   │   │       └── voice-rules.ts  # Extracted voice patterns and rules
│   │   │   │
│   │   │   ├── knowledge/
│   │   │   │   ├── search.ts        # pgvector similarity search functions
│   │   │   │   ├── ingest.ts        # Process raw content → embedded chunks
│   │   │   │   ├── workflowy.ts     # WorkFlowy API client + BrainLift sync
│   │   │   │   └── types.ts         # Knowledge source types
│   │   │   │
│   │   │   ├── scheduling/
│   │   │   │   └── budget-tracker.ts # Daily reply budget allocation
│   │   │   │
│   │   │   └── config/
│   │   │       ├── constants.ts     # Budget thresholds, active hours
│   │   │       └── boundaries.ts    # Messaging boundary rules (loaded from DB)
│   │   │
│   │   └── package.json
│   │
│   ├── functions/                   # Lambda handlers
│   │   ├── src/
│   │   │   ├── ingest-comments.ts   # Cron: poll IG for new comments (all posts)
│   │   │   ├── classify-comments.ts # Process: five-way classify new comments
│   │   │   ├── allocate-replies.ts  # Process: budget-aware reply allocation
│   │   │   ├── generate-replies.ts  # Process: generate replies for allocated comments
│   │   │   ├── post-replies.ts      # Cron: post approved replies via IG Graph API
│   │   │   ├── delete-comments.ts   # Cron: process delete-classified comments
│   │   │   ├── slack-approval.ts    # Webhook: handle Slack approve/reject callbacks
│   │   │   ├── slack-digest.ts      # Cron: daily activity summary + gap detection report
│   │   │   ├── auto-ingest.ts      # Cron: auto-ingest new content into knowledge bank
│   │   │   ├── refresh-token.ts     # Cron: refresh IG access token before expiry
│   │   │   └── health.ts            # Simple health check endpoint
│   │   │
│   │   └── package.json
│   │
│   └── scripts/                     # Data processing & scraping
│       ├── src/
│       │   ├── scrape-instagram.ts  # Apify scraping orchestration
│       │   ├── process-scrape-data.ts # Data transformation & analytics
│       │   ├── podcast-agent.ts     # Long-running: discover + transcribe all MacKenzie podcasts
│       │   └── apify-types.ts       # Type definitions for all data models
│       └── package.json
│
├── scripts/
│   ├── seed-knowledge.ts            # Ingest all BrainLifts + Apify data → knowledge_sources with embeddings
│   ├── seed-examples.ts             # Load labeled comment/response eval pairs
│   ├── run-eval.ts                  # Benchmark classifier against labeled eval dataset
│   └── test-pipeline.ts             # End-to-end test: comment in → reply out (no posting)
│
├── data/
│   ├── apify-raw/                   # Raw Apify scrape output (gitignored)
│   ├── voice-samples/               # MacKenzie's replies, captions, transcripts, analytics
│   ├── podcasts/                    # Discovered podcast transcripts (auto-populated by agent)
│   ├── eval-dataset.json            # 80-100 labeled comments with five-way classification
│   └── README.md                    # Data sources and how BrainLifts work (via WorkFlowy)
│
└── docs/
    ├── IMPLEMENTATION_PLAN.md       # This file
    ├── ARCHITECTURE.md              # System architecture notes
    └── PROMPTS.md                   # Prompt engineering notes and iterations
```

---

## Implementation Steps (in execution order)

### Phase 0: Foundation ✅ (partially complete)

**Step 0.1 — Create the repo and SST project** ✅ DONE
- SST monorepo scaffolded with packages/core, packages/functions, packages/scripts

**Step 0.2 — Run Apify scrape** ✅ DONE
- 777 posts scraped from @futureof_education
- 5,382 comments collected
- 182 MacKenzie reply pairs extracted
- Voice analytics computed (phrase frequency, emoji usage, response times)
- Data in `data/apify-raw/` and `data/voice-samples/`

**Step 0.3 — Set up RDS Postgres + pgvector** ✅ DONE
- VPC with EC2 NAT gateway (`infra/vpc.ts`)
- RDS Postgres 16 instance db.t4g.micro (`infra/database.ts`)
- Security group allowing port 5432 from within VPC
- Lambda wired to VPC with DB environment variables (`infra/api.ts`)
- SST config exports DatabaseEndpoint and DatabaseSecretArn

**Step 0.4 — Database schema + migrations** ✅ DONE
- Drizzle ORM schema with 10 tables, 5 enums (`packages/core/src/db/schema.ts`)
- Tables: accounts, posts, comments (5-way classification), replies (with edit tracking), knowledge_sources (vector embeddings), brainlift_sources (WorkFlowy sync), response_examples, voice_configs, api_usage, daily_budgets
- DB client factory (`packages/core/src/db/client.ts`)
- pgvector extension migration + Drizzle-generated schema migration
- Migration runner script (`scripts/migrate.ts`)
- Drizzle Kit config for generating future migrations
- HNSW vector indexes on knowledge_sources.embedding and response_examples.embedding

---

### Phase 1: Knowledge Base (BrainLift-Powered)

The bot's knowledge comes entirely from **BrainLifts** — structured knowledge documents that the team owns and maintains. This is the critical design principle: **if a topic isn't covered in a BrainLift, the bot stays quiet.** It skips rather than guesses, protecting the brand.

This means the team controls what the bot knows and can say. When new narratives emerge, new questions come up, or talking points change, the team updates the relevant BrainLift. The system re-ingests it. No dependency on engineering for knowledge updates.

**Step 1.1 — Build the embedding pipeline** ✅ DONE
- `packages/core/src/ai/embeddings.ts` — embedText, embedBatch, chunkText (smart splitting on paragraphs/sentences)
- Uses OpenAI text-embedding-3-small, 1536-dim vectors
- Handles batching up to 2048 texts per API call

**Step 1.2 — Build the WorkFlowy BrainLift sync** ✅ DONE
- `packages/core/src/knowledge/workflowy.ts` — WorkFlowy API client (getNode, getChildren, exportAll)
- syncBrainlifts() walks root node children, auto-detects BrainLift type from name
- Content hashing (SHA-256) for change detection — only re-embeds if content changed
- Recursive content collection from nested WorkFlowy nodes

**Step 1.3 — Build the knowledge ingestion pipeline** ✅ DONE
- `packages/core/src/knowledge/ingest.ts` — ingestContent, ingestBrainlift (with change detection), ingestResponseExample
- `packages/core/src/knowledge/search.ts` — searchKnowledge, searchExamples, retrieveForComment (RAG retrieval with source_weight boosting)
- `scripts/seed-knowledge.ts` — Seeds BrainLifts from WorkFlowy + IG captions + 182 reply pairs
- Run: `npm run migrate && npx tsx scripts/seed-knowledge.ts`

**Auto-ingest Lambda** ✅ DONE (`packages/functions/src/auto-ingest.ts`, deployed as hourly cron):
- EventBridge cron: hourly
- **WorkFlowy sync**: Check for BrainLift changes via API, re-embed updated sections
- **IG captions**: Scan for new posts detected by ingest Lambda → embed + store
- **Manual replies**: Check for new replies from Jay/Juliana/MacKenzie on IG → embed as high-weight voice training
- **Substack**: Pull RSS feed (`futureofeducation.substack.com/feed`), detect new posts, chunk + embed into Counter-Arguments and Institutional (weekly)
- **Alpha School website**: Scrape alpha.school for updated content (weekly) → embed into Institutional
- **Slack feedback**: On approval → ingest as positive example. On rejection/edit → store as negative signal. (Triggered by Slack webhook, not cron.)

**Step 1.4 — Build the podcast transcription agent** ✅ DONE
- `packages/scripts/src/podcast-agent.ts` — Long-running background agent
- Discovery: Searches YouTube + web for MacKenzie Price podcast appearances using 7 query variations
- Transcription: Downloads audio via yt-dlp, transcribes via Whisper API
- Progress tracking: `data/podcasts/manifest.json` — resumes from where it left off
- Run: `npx tsx packages/scripts/src/podcast-agent.ts` (requires YOUTUBE_API_KEY + OPENAI_API_KEY + yt-dlp installed)
- **Current scope**: One-time exhaustive sweep only. Run it, it discovers and transcribes everything, then stops.
- **Future**: Convert to a scheduled Lambda (weekly cron) that automatically checks for new MacKenzie podcast appearances and ingests them. The manifest prevents duplicate processing. This is a separate task for after the initial sweep is complete and the system is live.

**Step 1.5 — Populate BrainLifts in WorkFlowy** (blocked on content from team)

| BrainLift | WorkFlowy Location | Owner | What Goes In |
|-----------|-------------------|-------|-------------|
| **Counter-Arguments** | TBD (WorkFlowy node) | MacKenzie + Jay | Talking points per narrative (screen time/Sweden, AI in education, etc.), supporting sources/studies, forbidden claims per topic. Each narrative as a sub-node. |
| **Voice & Tone** | TBD (WorkFlowy node) | MacKenzie | Top comment answers Jay is pulling, tone rules, emoji patterns, banned phrases, personality markers. Highest-weight training data. |
| **Institutional Knowledge** | TBD (WorkFlowy node) | Team | Alpha School facts: enrollment, locations, programs, guides, reward system, expansion plans. Used for informational responses in comments. |
| **Deletion Guidelines** | TBD (WorkFlowy node) | Jay | Patterns that trigger deletion (trolls, spam, bad-faith), examples of criticism that must stand, the decision tree Jay uses for his ~20 daily deletions. |
| **Messaging Boundaries** | TBD (WorkFlowy node) | MacKenzie + Jay | Approved claims (CAN say), forbidden claims (NEVER say), topics requiring human escalation, tone rules per classification group. |

**Step 1.6 — Build the eval dataset** ✅ DONE (auto-labeled by classifier, sent to Jay for human verification)
- `scripts/build-eval-dataset.ts` — Pulls diverse sample from 5,359 scraped comments
- 110 comments sampled: ~25 narrative, ~20 community, ~15 informational, ~15 delete, ~10 skip, ~15 boundary, ~10 MacKenzie-replied
- Output: `data/eval-dataset.json` — classification fields are null, needs human labeling
- For each, label with the **five-way classification**:
  - `classification`: "narrative_shaping" | "community_building" | "informational" | "delete" | "skip"
  - `narrative_topic`: (for narrative_shaping comments) "screen_time" | "ai_education" | etc.
  - `ideal_response`: what MacKenzie would say (if applicable)
- Must include deletion boundary examples — legitimate criticism that should stand vs trolling that gets deleted
- Include examples from current hot narratives
- Include examples of all community building subtypes (emoji reactions, casual Q&A, encouragement, commiseration)
- Include informational examples (enrollment questions, location inquiries, program details, "how does Alpha work?" type questions)
- Include boundary between informational and community_building (factual question vs casual chat)

---

### Phase 2: AI Pipeline

**Step 2.1 — Build the five-way classifier** ✅ DONE
`packages/core/src/ai/classifier.ts`
- Input: comment text, post caption context, comment likes count, thread position (top-level vs reply)
- Output:
```typescript
{
  classification: 'narrative_shaping' | 'community_building' | 'informational' | 'delete' | 'skip';
  confidence: number;
  narrative_topic?: string;       // for narrative_shaping
  info_type?: string;             // for informational (enrollment, location, program, schedule, etc.)
  skip_reason?: string;           // for skip
  delete_reason?: string;         // for delete
}
```
- Uses Claude (high-capability model)
- Classification logic:
  1. Does this mention a specific child, mental health, abuse, or legal issue? → HARD SKIP
  2. Is this from a verified or high-follower account? → FLAG for human handling
  3. Is this troll, spam, or bad-faith with no substantive content? → DELETE
     - **Critical guardrail**: Negative opinions about Alpha School, education philosophy, screen time, etc. are NEVER classified as delete, even if hostile in tone. Only pure trolling, spam, and bad-faith actors.
  4. Does this touch an active narrative topic (screen time, AI, etc.) AND have high visibility (likes)? → NARRATIVE_SHAPING
  5. Is this asking a factual question about Alpha (enrollment, locations, programs, schedule, how it works)? → INFORMATIONAL
     - Complex or sensitive inquiries (specific child situations, financial details) → direct to DMs instead
  6. Is this a positive comment, casual question, encouragement, or community moment? → COMMUNITY_BUILDING
  7. Everything else → SKIP

**Step 2.2 — Run classifier eval**
`scripts/run-eval.ts`
- Load eval dataset (80-100 labeled examples)
- Run each through the five-way classifier
- Compare classifier output to human labels
- Calculate per-class agreement rates
- Pay special attention to delete/skip boundary (never misclassify criticism as delete)
- Pay attention to informational vs community_building boundary (factual questions vs casual chat)
- Iterate on the prompt until overall agreement > 85%

**Step 2.3 — Build the knowledge retrieval function**
`packages/core/src/knowledge/search.ts`
- Input: comment text, classification_group, narrative_topic (if applicable)
- Process: embed the comment, run pgvector similarity search across BrainLift-sourced knowledge
- For **community_building**: top 5 similar response_examples from Voice & Tone BrainLift (to match MacKenzie's casual voice)
- For **informational**: top 5 knowledge_sources from Institutional Knowledge BrainLift, filtered by `info_type`. Must return factually accurate, current information (enrollment, locations, programs, etc.)
- For **narrative_shaping**: top 5 knowledge_sources from Counter-Arguments BrainLift weighted by `source_weight`, top 3 similar response_examples. Boost results tagged with the matching `narrative_topic`.
- **Knowledge guardrail**: if retrieval returns no relevant results above a confidence threshold for a narrative_shaping comment, downgrade to SKIP. The bot does not improvise on sensitive topics.
- Also queries Messaging Boundaries BrainLift for the detected topic
- Dedup: filter out results with > 0.95 cosine similarity to each other

**Step 2.4 — Build the tri-mode reply generator** ✅ DONE
`packages/core/src/ai/generator.ts`
- Input: comment, post caption, classification_group, retrieved knowledge, similar examples, messaging boundaries, narrative playbook (if applicable)
- **Community building mode**:
  - Short: under 150 chars
  - Emoji-heavy, warm, casual
  - Match MacKenzie's lighthearted voice (emojis like 👏, 😂, 🙏, ❤️)
  - Types: encouragement, thank you, commiseration, casual Q&A
- **Narrative shaping mode**:
  - Substantive: up to 500 chars
  - Factual, empathetic but firm — never defensive or emotional
  - Uses Counter-Arguments BrainLift: key arguments, sources, and examples for the matched narrative
  - Cites specific programs, data, or experiences at Alpha
  - Avoids forbidden_claims from the BrainLift
  - If the BrainLift doesn't have enough info for this specific narrative, returns `{ skip: true }` — never improvises
- **Informational mode**:
  - Helpful, accurate, concise: under 300 chars
  - Pulls from Institutional Knowledge BrainLift (enrollment, locations, programs, schedule)
  - MacKenzie's warm voice but informative — not robotic FAQ answers
  - For complex inquiries (specific child situations, financial details): respond with "DM us for details on that!" and direct to DMs
  - Must use current data — if the BrainLift doesn't have the answer, skip rather than guess outdated info
- All modes:
  - System prompt includes: MacKenzie voice rules, tone patterns, banned phrases
  - Output: `{ reply_text: string }` or `{ skip: true, reason: string }`
  - Uses Claude Sonnet
  - Must not use em dashes or phrases MacKenzie wouldn't use

**Step 2.5 — End-to-end pipeline test** ✅ DONE
`scripts/test-pipeline.ts`
- Takes a comment string + post context as input
- Runs: classify → retrieve → generate
- Prints: classification result, retrieved context, generated reply
- Does NOT post to Instagram
- Test with 20-30 comments from the eval dataset across all five classification categories
- Verify narrative shaping replies use playbook content
- Verify community building replies match MacKenzie's emoji-heavy casual style
- Verify informational replies are accurate and pull from Institutional Knowledge BrainLift
- Verify deletion candidates are correctly identified with guardrails intact

---

### Phase 3: Infrastructure

**Step 3.1 — Build the Instagram API wrapper** ✅ DONE
`packages/core/src/instagram/api.ts`
- `getRecentPosts(accountId)` → list of posts with recent comment activity
- `getComments(mediaId, since)` → list of comments on a post (with likes count)
- `postReply(commentId, message)` → post a reply as the account
- `deleteComment(commentId)` → delete a comment (troll/spam management)
- `getRateLimitStatus(accountId)` → check current API usage
- Handle pagination, error codes, rate limit headers

**Step 3.2 — Build the daily reply budget system** ✅ DONE
`packages/core/src/scheduling/budget-tracker.ts`
- `getDailyBudget(commentVolume: number)` → target reply count
  - Normal day (~150 comments): 10-15 replies
  - High volume (250+ comments): 30-40 replies
  - Linear interpolation between thresholds
- `getRemainingBudget(date: Date)` → replies left for today
- `allocateReplies(classifiedComments, remainingBudget)` → prioritized list
  - Priority 1: narrative_shaping comments, sorted by likes_count desc
  - Priority 2: community_building comments, sorted by likes_count desc
  - Spread allocation across active hours (8am-10pm CT), not batched

**Step 3.3 — Build the ingest Lambda** ✅ DONE
`packages/functions/src/ingest-comments.ts`
- EventBridge cron: every 5 minutes
- For each active account:
  - Fetch new comments across ALL posts with recent activity (no post-age cutoff)
  - Daily deep scan: once per day, check older posts for new comment threads
  - Deduplicate against existing `ig_comment_id` in DB
  - Insert new comments with `classification_group = null` (pending classification)
  - Store `likes_count` for priority scoring
  - Skip comments from the account owner (don't reply to yourself)

**Step 3.4 — Build the classify Lambda** ✅ DONE
`packages/functions/src/classify-comments.ts`
- EventBridge cron: every 10 minutes
- Query comments where `classification_group IS NULL`
- Run each through the five-way classifier
- Update comment with classification result and narrative_topic
- Route `delete`-classified comments to deletion pipeline

**Step 3.5 — Build the allocate Lambda** ✅ DONE
`packages/functions/src/allocate-replies.ts`
- EventBridge cron: every 15 minutes
- Check daily budget remaining via budget-tracker
- Pull all classified but unallocated comments (narrative_shaping + community_building + informational)
- Run allocation: select highest-impact comments within remaining budget
- For each allocated comment: run retrieval + generation pipeline
- Route generated replies based on rollout phase:
  - Approval mode → post to Slack with approve/reject buttons
  - Auto mode → insert with `approval_status = 'auto'`

**Step 3.6 — Build the post Lambda** ✅ DONE
`packages/functions/src/post-replies.ts`
- EventBridge cron: every 2 minutes
- Query replies where `approval_status IN ('approved', 'auto')` and not yet posted
- Spread timing: don't post more than 2-3 replies in a single run
- Post via Graph API
- Update reply status to 'posted' with `ig_reply_id` and `posted_at`
- On failure: update status to 'failed' with `failure_reason`

**Step 3.7 — Build the delete Lambda (confidence-scored)** ✅ DONE
`packages/functions/src/delete-comments.ts`
- EventBridge cron: every 15 minutes
- Query comments where `classification_group = 'delete'` and `deleted_at IS NULL`
- **Confidence-scored routing**:
  - High confidence (>95%): auto-delete immediately (obvious spam, link bots, foreign language spam) — no human needed
  - Medium confidence (70-95%): post to Slack with comment text + delete reason + approve/reject
  - Low confidence (<70%): reclassify as SKIP (let it stand)
- **Critical guardrail**: negative opinions about Alpha are NEVER deleted regardless of confidence score. Only pure trolls, spam, and bad-faith actors.
- On approval/execution: set `deleted_at` and `deleted_by = 'bot'`
- Reduces Jay's ~20 daily manual deletions significantly from day 1

**Step 3.8 — Build the Slack approval system (with feedback loop)** ✅ DONE
`packages/functions/src/slack-approval.ts`
- Slack Bot with interactive message components (Block Kit)
- **Message format**: comment text, post caption context, classification, proposed reply (or deletion reason), three action buttons
- **Approve button**: Update reply `approval_status = 'approved'` → post to IG. Feedback loop: embed (comment + reply) as positive training pair with `source_weight = 2.0`.
- **Edit button**: Opens a **Slack modal** (`views.open`) pre-filled with the bot's proposed reply text. Jay/Juliana edits the text and submits. System posts the edited version to IG. Feedback loop: store bot's original as negative example, store (comment + edited reply) as positive pair with `source_weight = 2.5` (corrections are highest-value training data).
- **Reject button**: Do NOT post to IG. Optional rejection reason text field. Feedback loop: store bot's reply as negative example. If Jay/Juliana later replies manually on IG, the daily scan detects it and stores their reply as a positive pair.
- **For deletions**: Same Approve/Reject flow (no Edit). Approve executes the deletion. Reject reclassifies the comment as skip.
- Requires Slack App with `chat:write`, `commands`, and `interactive` scopes
- Over time: the bot gets better because of Jay's corrections, not despite them

**Step 3.9 — Build the Slack digest Lambda (with gap detection)** ✅ DONE
`packages/functions/src/slack-digest.ts`
- EventBridge cron: daily at 9am CT
- Query last 24 hours of activity:
  - Comments ingested (total)
  - Classification breakdown (narrative_shaping / community_building / informational / delete / skip counts)
  - Replies posted (with approval vs auto breakdown)
  - Deletions executed (auto vs approved)
  - Any failures or flagged items
  - Budget utilization (replies posted vs budget)
- **Gap detection report** (weekly section):
  - Comments the bot skipped because RAG returned no relevant results
  - Grouped by detected topic/theme
  - Example: "12 comments about [homeschool regulations] — not enough info to respond. Consider updating Counter-Arguments BrainLift."
  - Surfaces emerging narratives the team may not have noticed
- Format and send to dedicated bot Slack channel

**Step 3.10 — Build token refresh Lambda** ✅ DONE
`packages/functions/src/refresh-token.ts`
- EventBridge cron: daily
- Check if token expires within 7 days
- If yes, refresh via Graph API token exchange
- Update accounts table with new token and expiry

**Step 3.11 — Deploy to AWS via SST** ✅ DONE (dev stage deployed)
- VPC + NAT instances running
- RDS Postgres 16 (`ig-commenter-dev.cmt24wmmkgfr.us-east-1.rds.amazonaws.com`)
- Database schema migrated, pgvector enabled
- Knowledge bank seeded: 33 podcasts, 748 captions, 182 reply pairs, 20 Substack posts
- All 8 cron Lambdas deployed and scheduled
- Slack approval Function URL: active and connected to `#alpha-bot-test`
- Seeder Lambda with dedup logic
- Migrator Lambda for schema updates

**Deployment URLs:**
- API: `https://pfd45xob52h7flv5ivkhahamvm0fdntx.lambda-url.us-east-1.on.aws/`
- Slack Handler: `https://oroytpfq4zjk7hke5xtyqvdrwa0qhzvt.lambda-url.us-east-1.on.aws/`
- Seeder: `https://p7oev24ph5xiw6lkiqb3h64jgq0jcpsa.lambda-url.us-east-1.on.aws/`
- Migrator: `https://cxgj3lt6suunurstsykcsizcay0pgniz.lambda-url.us-east-1.on.aws/`

---

### Phase 4: Testing & Launch

**Step 4.1 — Connect test Instagram account**
- In Meta App dashboard, add a test IG account (must be Business/Creator)
- Generate access token
- Run the full pipeline against test account
- Verify: comments ingested, classified (all 5 categories), replies generated, deletions flagged

**Step 4.2 — Record screencast for App Review**
- Screen record the full flow: comment appears → system classifies → generates reply → posts reply
- Show the Slack approval workflow
- Show deletion with guardrails
- Submit for Meta App Review

**Step 4.3 — Voice session with MacKenzie + Jay call**
- Review MacKenzie's comment reply patterns from scrape data (182 reply pairs, voice analytics)
- Discuss tone rules, banned phrases, approved talking points
- Fill in narrative playbooks with actual content
- Get Jay's deletion parameters (what to delete vs let stand)
- Finalize messaging boundaries
- Get sign-off on what the bot can/cannot say
- Use prepared questions (see "Questions for Jay/MacKenzie Call" below)

**Step 4.4 — Connect MacKenzie's account (after App Review approved)**
- MacKenzie logs in via the OAuth flow (2 minutes)
- Generate production access token
- Switch the system to her account

**Step 4.5 — Go live (6-week rollout)**

| Weeks | Mode | Details |
|-------|------|---------|
| **1-2** | Full Slack approval | Every reply and deletion goes to dedicated Slack channel. Jay or Juliana approve/reject/edit each one. Nothing auto-posts. |
| **3-4** | Partial auto | Community building (Group #1) replies go auto. Narrative shaping (Group #2) replies stay in Slack approval. Deletions stay in approval. |
| **5-6** | Full auto | All classifications go auto. Daily Slack digest of everything posted. Deletion may remain approval-gated if team prefers. |

- **Approvers**: Jay Lyons and Juliana (NOT MacKenzie)
- **Slack channel**: Dedicated channel for this bot (not the existing Future of Education channel)
- **Tuning**: Edits and rejections from weeks 1-4 feed back into prompt refinement

---

### Phase 5: DM Automation (replaces ManyChat)

Uses the same RAG pipeline and knowledge bank as the comment bot. Different ingestion source (DMs) and generation mode (private, conversational, multi-turn).

**Key use cases Jay identified:**
- International requests → canned response: "We're not ready for international expansion but hopefully soon, sign up here to get updated"
- Informational questions that Mary currently handles (enrollment, locations, programs)
- Auto-replies/surveys to new followers (currently planned for ManyChat)

**Prerequisites:**
- IG comment bot stable (Phase 4 underway)
- Additional Meta App permissions: `instagram_manage_messages`, `pages_messaging`
- Submit for Meta App Review with DM-specific screencast
- Inventory of ManyChat flows from Jay (to build equivalent functionality)

**Architecture:**
- Shares entire knowledge bank with comment bot (same BrainLifts, same RAG pipeline)
- Separate generator mode: private, conversational, multi-turn (vs. public, single-turn comments)
- Different guardrails: DMs can be more detailed/informational since they're private
- Start with top 5 pattern-matched DM types, expand from there
- Transition plan: run alongside ManyChat initially, then migrate flows entirely

---

### Phase 6: Facebook Comments (future)

The @futureof_education Facebook community has ~200k followers with an equally active comment section.

**Prerequisites:**
- IG comment bot + DM automation stable
- Additional Meta App permissions: `pages_read_engagement`, `pages_manage_engagement`
- Submit for Meta App Review with FB-specific screencast
- Briefing from Jay on FB comment culture (may differ from IG)

**Architecture:**
- Same AI pipeline (classifier, generator, budget system) — just a new ingestion source
- DB already future-proofed with `platform` column (default 'instagram')
- New ingest source: Facebook Graph API for page post comments
- May need classifier tuning if FB comment patterns differ from IG
- Same Slack approval workflow

---

## Questions for Jay/MacKenzie Call

### ManyChat & Future Scope
1. What specific ManyChat flows are you setting up, and what's the timeline? We want to make sure nothing conflicts — our system will eventually replace ManyChat entirely.
2. Are there any ManyChat flows that should remain separate vs. migrated into our system?

### Facebook Comments
3. Is the FB comment culture different from IG? Different types of trolls, different hot topics, different tone expectations?
4. Who currently manages FB comments — same team (Jay/Juliana) or different people?

### Deletion
5. Walk us through your deletion decision tree: what specific patterns trigger a delete vs. letting a negative comment stand? (This feeds directly into the Deletion Guidelines BrainLift.)

### BrainLifts Needed
The bot's entire knowledge comes from BrainLifts. If a topic isn't covered, the bot stays quiet — it never guesses. This means the BrainLifts are what determine how effective the bot is, and the team can keep them updated as new narratives, questions, and pushbacks emerge.

We need three BrainLifts to get started:
- **Counter-Arguments BrainLift** — covering the hot narratives (screen time/Sweden, AI in education, and any others emerging). Key talking points, supporting sources/studies, and what should never be said per topic. As new narratives emerge, the team adds them here and the bot learns them.
- **Deletion Guidelines BrainLift** — what patterns to delete vs let stand, so the bot can help with the ~20/day Jay currently handles manually.
- **Voice & Tone BrainLift** — MacKenzie's top comment answers that Jay is already pulling. These become the highest-weight training data for how the bot sounds.

**Note on FB & DMs**: Once we have IG comments working and the team is happy with it, I'll request additional Meta permissions for FB comments and DMs. Same review process — no extra work from your side.

---

## Environment Variables

```env
# Database
DATABASE_URL=postgres://user:pass@host:5432/dbname

# Instagram Graph API
IG_APP_ID=929955626406260
IG_APP_SECRET=<from Meta App dashboard>
IG_ACCESS_TOKEN=<generated when account is connected>

# AI
ANTHROPIC_API_KEY=<Claude API key>
OPENAI_API_KEY=<for embeddings + Whisper transcription>

# Slack
SLACK_BOT_TOKEN=<Slack Bot OAuth token>
SLACK_SIGNING_SECRET=<for verifying Slack webhook requests>
SLACK_APPROVAL_CHANNEL_ID=<dedicated bot channel for approvals>
SLACK_DIGEST_CHANNEL_ID=<for daily digest, can be same channel>

# WorkFlowy (BrainLift sync)
WORKFLOWY_API_TOKEN=<WorkFlowy API token>
WORKFLOWY_BRAINLIFT_ROOT_ID=<root node ID containing all BrainLifts>

# Substack
SUBSTACK_RSS_URL=https://futureofeducation.substack.com/feed

# Daily Reply Budget
DAILY_REPLY_BUDGET_NORMAL=15       # Target replies on a normal day (~150 comments)
DAILY_REPLY_BUDGET_HIGH=40         # Target replies on a big day (300+ comments)
HIGH_VOLUME_THRESHOLD=250          # Comment count that triggers high budget
ACTIVE_HOURS_START=8               # CT - earliest the bot posts replies
ACTIVE_HOURS_END=22                # CT - latest the bot posts replies

# Feature Flags
DELETION_ENABLED=false             # Enable/disable comment deletion
CLASSIFIER_SKIP_IF_UNSURE=true     # Skip rather than risk a bad reply

# Apify (initial scrape only)
APIFY_TOKEN=<for scraping>
```

---

## BrainLift Content Needed (from Jay/Team)

### Blocks IG Comment Bot (Phases 0-4)

| BrainLift | What We Need | From Whom | How |
|-----------|-------------|-----------|-----|
| **Counter-Arguments** | Talking points for each hot narrative (screen time/Sweden, AI in education, others). Sources, studies, what to never say. | MacKenzie + Jay | BrainLift session or written doc |
| **Voice & Tone** | MacKenzie's top comment answers (Jay is already pulling this list). Tone rules, emoji patterns, banned phrases. | Jay (list) + MacKenzie (answers) | Jay provides list → MacKenzie answers → we ingest |
| **Deletion Guidelines** | Decision tree for what to delete vs let stand. 20-30 labeled examples. | Jay | Written doc or walkthrough on call |
| **Messaging Boundaries** | Approved claims, forbidden claims, escalation triggers. | MacKenzie + Jay | BrainLift session |
| **Substack RSS** | Confirm RSS feed URL for MacKenzie's Substack (assumed: `futureofeducation.substack.com/feed`) | Team | URL confirmation |
| **WorkFlowy access** | API token + root node ID for BrainLift content in WorkFlowy | MacKenzie | API setup |
| **Podcast list** | Known podcast appearances (URLs) to seed the discovery agent; agent will find more on its own | Team | URL list |

### Blocks FB Expansion (Phase 5)
- Additional Meta App permissions (requested after IG comments are proven)
- FB comment culture briefing from Jay

### Blocks DM Automation (Phase 6)
- Additional Meta App permissions (requested after IG comments are proven)
- ManyChat flow inventory from Jay
- DM-specific requirements from team

---

## Key Files to Build First (Priority Order)

1. `packages/core/src/db/schema.sql` — Full schema with platform, classification_group (5-way), brainlift_sources, budget tracking
2. `packages/core/src/ai/embeddings.ts` — Embedding pipeline (foundation for RAG)
3. `packages/core/src/knowledge/workflowy.ts` — WorkFlowy API client + BrainLift sync
4. `scripts/seed-knowledge.ts` — BrainLift + scraped data ingestion with source weights
5. `packages/core/src/knowledge/search.ts` — pgvector similarity search with confidence threshold
6. `packages/core/src/ai/classifier.ts` — Five-way classifier with confidence scoring
7. `packages/core/src/ai/generator.ts` — Tri-mode generator with RAG grounding
8. `packages/core/src/scheduling/budget-tracker.ts` — Daily reply budget allocation
9. `packages/functions/src/slack-approval.ts` — Approval workflow with Slack modal + feedback loop
10. `packages/functions/src/auto-ingest.ts` — Automated knowledge bank updates (WorkFlowy, Substack, IG, website)
11. `packages/scripts/src/podcast-agent.ts` — Long-running podcast discovery + transcription agent
12. `packages/core/src/instagram/api.ts` — Graph API wrapper including deleteComment()
13. Everything else

### Future (separate planning)
- VIP/Influencer detection and tracking
