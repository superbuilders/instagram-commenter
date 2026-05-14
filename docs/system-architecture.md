# Instagram Comment Manager — System Architecture

> Technical overview for engineers joining or integrating with the system.

---

## What This System Does

An AI-powered Instagram comment management bot for **@futureof_education** (MacKenzie Price / Alpha School). It automatically ingests comments, classifies them, generates contextual replies grounded in a knowledge bank, and routes them through Slack for human approval before posting.

The system handles ~4,500+ comments/month with a small team reviewing AI-generated replies via Slack.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Infrastructure | AWS SST v3 (serverless) |
| Compute | AWS Lambda (Node.js/TypeScript) |
| Database | PostgreSQL 16.4 on RDS (db.t4g.micro) with **pgvector** extension |
| AI - Classification & Generation | Claude Sonnet 4 (Anthropic API) |
| AI - Embeddings | OpenAI `text-embedding-3-small` (1536 dims) |
| Scheduling | AWS EventBridge cron triggers |
| Human Review | Slack (Block Kit messages + interactive modals) |
| Knowledge Sources | WorkFlowy API, Substack RSS, Instagram Graph API, website scrape |
| Secrets | AWS Secrets Manager (via SST Secrets) |
| Networking | VPC with private subnets + NAT gateway |

**Monorepo structure** (npm workspaces):
- `packages/core` — shared business logic (AI, DB, integrations, knowledge retrieval)
- `packages/functions` — Lambda handlers
- `packages/scripts` — one-off utilities

---

## Pipeline Overview

The system runs as a series of independent cron-triggered Lambdas that communicate through database state:

```
Instagram API
     │
     ▼
 ┌────────────┐    ┌──────────────┐    ┌─────────────────┐    ┌────────────┐
 │   INGEST   │───▶│   CLASSIFY   │───▶│    ALLOCATE +    │───▶│    POST    │
 │  (5 min)   │    │  (10 min)    │    │  GENERATE REPLY  │    │  (2 min)   │
 │            │    │              │    │    (15 min)       │    │            │
 └────────────┘    └──────────────┘    └────────┬──────────┘    └────────────┘
                                                │                      ▲
                                                ▼                      │
                                         ┌─────────────┐              │
                                         │    SLACK     │──(approve)──┘
                                         │   APPROVAL   │
                                         └─────────────┘
```

### 1. Ingest Comments (every 5 min)

- Fetches the 25 most recent posts via Instagram Graph API (`/v21.0/{accountId}/media`)
- For each post: fetches comments with pagination (up to 5 pages), including nested replies
- Deduplicates by `platformCommentId` and skips the account owner's own comments
- Upserts posts and comments into PostgreSQL

### 2. Classify Comments (every 10 min)

- Picks up unclassified comments in batches of 20
- Sends each to Claude with a detailed classification prompt
- Assigns one of 5 groups:

| Group | Description | Priority |
|-------|------------|----------|
| `narrative_shaping` | Hot-button topics (screen time, AI in education, school philosophy) — high-engagement comments | 1st |
| `community_building` | Personal, encouraging, casual questions | 2nd |
| `informational` | Factual questions about Alpha School (enrollment, location, cost) | 3rd |
| `delete` | Pure spam/trolling with zero substance | N/A |
| `skip` | Everything else (emoji-only, single words, sensitive topics, high-follower accounts) | N/A |

Each classification includes a confidence score (0-1) and, where applicable, a `narrativeTopic` or `infoType` subclassification.

**Important rule:** Negative opinions are classified as `skip`, never `delete`. Only zero-substance spam/trolling gets `delete`.

### 3. Allocate Replies + Generate (every 15 min)

**Budget calculation** — replies per day scales with comment volume:
| Daily comments | Reply budget |
|---|---|
| <50 | 5 |
| <100 | 8 |
| <150 | 15 |
| <250 | 25 |
| 250+ | 40 |

**Priority allocation:**
1. Sort actionable comments by classification priority (narrative > community > informational)
2. Within each tier, sort by `likesCount` descending
3. Take top N up to remaining daily budget

**Knowledge retrieval (RAG):** For each selected comment:
1. Embed comment text via OpenAI
2. Vector similarity search against `knowledgeSources` table (pgvector cosine distance)
   - Filter by relevant `brainliftType` based on classification
   - Minimum similarity threshold: 0.35, boosted by `sourceWeight`
3. Separate search for similar approved reply examples from `responseExamples`
4. **Guard:** If `narrative_shaping` but no relevant knowledge found, skip (don't hallucinate)

**Reply generation:** Claude Sonnet 4 generates the reply given:
- The comment text + post caption for context
- Retrieved knowledge snippets
- Similar approved replies (voice reference)
- Voice rules derived from analysis of 182 real MacKenzie replies
- Constraints: <500 chars, 1-2 emojis max, no em dashes

### 4. Slack Approval (webhook, on human action)

Each generated reply is posted to a Slack approval channel with Block Kit buttons:

- **Approve** — marks reply as approved, ingests as positive training example
- **Edit** — opens a modal pre-populated with the reply, stores the edit, ingests original as negative + edited as positive
- **Reject** — marks as rejected, ingests as negative training example

Every human action feeds back into the `responseExamples` table, improving future reply quality.

Slack signature verification (HMAC-SHA256) protects the webhook endpoint.

### 5. Post Replies (every 2 min)

- Fetches up to 3 approved/auto-approved replies per run (rate limit safety)
- Posts each via Instagram Graph API (`/{commentId}/replies`)
- Updates the reply record with `postedAt`, `platformReplyId`, and `postedText`
- Increments daily budget counters

### 6. Delete Comments (every 15 min)

- Finds comments classified as `delete`
- Confidence >= 95%: auto-delete via Instagram API
- 70-95%: send to Slack for human confirmation
- <70%: reclassify as `skip` (not confident enough)

### 7. Supporting Crons

| Function | Schedule | Purpose |
|----------|----------|---------|
| `slack-digest` | Daily 2pm UTC | Posts daily summary (comments seen, replies allocated/approved/posted, classification breakdown) |
| `refresh-token` | Daily | Refreshes Instagram access tokens 7 days before expiration |
| `auto-ingest` | Hourly | Syncs knowledge bank from external sources |

---

## Knowledge Bank (RAG System)

The system maintains a vector-searchable knowledge base that grounds AI replies in real information. Knowledge is chunked (~1000 chars with 200 char overlap), embedded, and stored in `knowledgeSources` with pgvector.

### Sources

| Source | Method | Frequency | Weight |
|--------|--------|-----------|--------|
| WorkFlowy BrainLifts | API sync with SHA-256 change detection | Hourly | 1.0-2.0 |
| Substack posts | RSS feed parsing | Weekly | 1.2 |
| Podcast transcripts | YouTube search + Whisper transcription | One-time seed | 0.8-1.5 |
| Instagram captions | Auto-ingest on each ingest cycle | Every 5 min | 1.0 |
| Team's manual IG replies | Scrape account owner replies | Daily | 2.0 (highest) |
| Slack feedback | Approved/edited/rejected replies | On each action | 1.0 |
| Alpha School website | HTTP scrape, HTML-to-text | Weekly | 1.0 |

### BrainLift Types

These categorize knowledge for targeted retrieval:

- `counter_arguments` — responses to common criticisms (screen time, AI concerns)
- `voice_tone` — MacKenzie's communication style and personality
- `institutional` — facts about Alpha School (locations, programs, enrollment)
- `deletion_guidelines` — rules for what constitutes spam vs. legitimate criticism
- `messaging_boundaries` — topics to avoid or handle carefully

### Retrieval Strategy

When generating a reply, the system searches for:
1. **Knowledge chunks** matching the comment's classification and topic (5 results)
2. **Approved reply examples** matching the classification group (3 results)

Results are ranked by `similarity * sourceWeight`, ensuring high-weight sources (like MacKenzie's own replies at 2.0x) are prioritized.

---

## Database Schema (Key Tables)

```
accounts          — Instagram accounts (credentials, tokens)
posts             — Ingested Instagram posts (caption, media type, permalink)
comments          — All comments with classification fields
replies           — AI-generated replies with approval status + Slack tracking
knowledgeSources  — RAG vector store (content chunks + 1536-dim embeddings)
brainliftSources  — WorkFlowy sync tracking (node IDs, content hashes)
responseExamples  — Feedback loop training data (positive/negative examples)
dailyBudgets      — Per-account daily reply budget and counters
apiUsage          — Cost tracking for AI API calls
voiceConfigs      — Reserved for per-account AI tuning (not yet active)
```

All comments use soft deletes (`deletedAt` timestamp) for audit trail.

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Cron-based pipeline (not Step Functions)** | Simpler to debug, each stage is independent, communicates through DB state. No complex orchestration needed. |
| **PostgreSQL + pgvector (not Pinecone/Weaviate)** | Single database for everything. At our scale (<100k embeddings), pgvector is sufficient and eliminates a separate service. |
| **Human-in-the-loop via Slack** | Brand safety is critical. No substantive replies auto-post. Every reply is reviewed. The approval flow also captures training data. |
| **Daily reply budgets** | Prevents runaway posting. Scales with engagement volume. Keeps the reply cadence natural. |
| **Knowledge-grounded generation** | Replies must be factually accurate. If no relevant knowledge is found for a narrative-shaping comment, the system skips rather than hallucinate. |
| **Feedback loop** | Every Slack approve/edit/reject action becomes training data in `responseExamples`, improving future reply quality over time. |
| **Soft deletes** | Never physically delete comment data. Audit trail for all classification and deletion decisions. |
| **Source weighting** | MacKenzie's own manual replies (2.0x) are weighted highest for voice matching. Podcasts (0.8x) are lower since they're conversational, not polished. |

---

## Deployment & Operations

- **Deploy:** `npx sst deploy --stage <stage>` (SST handles all AWS resource provisioning)
- **Migrations:** Drizzle ORM migrations, applied via the `run-migrate` Lambda
- **Seeding:** `run-seed` Lambda bulk-loads initial knowledge bank (podcasts, captions, Substack)
- **Monitoring:** Slack digest provides daily metrics. CloudWatch for Lambda errors.
- **Token refresh:** Automated daily. Instagram long-lived tokens last ~60 days; refresh triggers 7 days before expiry.

---

## Architecture Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │              EXTERNAL SOURCES                │
                    │  WorkFlowy | Substack | Website | Podcasts  │
                    └──────────────────┬──────────────────────────┘
                                       │ (auto-ingest, hourly)
                                       ▼
┌──────────┐     ┌──────────────────────────────────────────┐
│Instagram │     │           KNOWLEDGE BANK                  │
│Graph API │     │  knowledgeSources (pgvector embeddings)   │
│          │     │  responseExamples (feedback loop)          │
└────┬─────┘     └──────────────────┬───────────────────────┘
     │                              │
     │ (ingest, 5min)               │ (RAG retrieval)
     ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     POSTGRESQL (RDS)                         │
│  accounts | posts | comments | replies | dailyBudgets       │
└────────────────────────────┬────────────────────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
   │  CLASSIFY   │   │  ALLOCATE   │   │    POST     │
   │  (Claude)   │   │ + GENERATE  │   │  (IG API)   │
   │             │   │  (Claude +  │   │             │
   │             │   │   RAG)      │   │             │
   └─────────────┘   └──────┬──────┘   └──────▲──────┘
                             │                 │
                             ▼                 │
                      ┌─────────────┐          │
                      │    SLACK    │──────────┘
                      │  APPROVAL   │  (approve/edit)
                      │  CHANNEL    │
                      └─────────────┘
```
