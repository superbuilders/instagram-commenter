# Instagram Comment Bot — How It Works

## What This Is

A system that responds to Instagram comments as MacKenzie — in her voice, with her knowledge, at her discretion. It's not replacing MacKenzie in the comments. It's amplifying her presence across the 4,500+ comments that come in every month.

## The Two Jobs

**Community Building**
The bot offers MacKenzie's personal touch — fun, lighthearted, emoji-heavy encouragement. Commiserating with parents about the school system, answering casual questions ("where'd you get those boots?"), thanking loyal followers. Followers are thrilled when they get a response from MacKenzie, and the bot makes that happen more often.

**Narrative Shaping (the big one)**
Top comments get thousands of likes. Tens of thousands of people read them. When someone posts "research shows screen time ruins kids" or "AI is destroying children's brains," that narrative shapes how people see Alpha — unless MacKenzie weighs in. The bot ensures she always does, with her talking points, her tone, and her knowledge. Succinct, factual, never defensive.

## How It Stays Safe

**It only knows what you teach it.** The bot's entire knowledge comes from BrainLifts — structured documents the team creates and maintains. If a topic isn't covered in a BrainLift, the bot stays quiet. It never guesses or improvises on sensitive topics.

**It doesn't respond to everything.** On a normal day (~150 comments), the bot replies to 10-15. On a big day (300+ comments), 30-40. It picks the highest-impact comments — narrative shaping threads first, then community moments. This matches MacKenzie's natural engagement pattern and avoids looking like a bot.

**It can help with deletion.** Jay currently deletes ~20 troll/spam comments per day. The bot can flag these for deletion — but it will never delete legitimate criticism, even if the tone is hostile. Negative opinions about Alpha stand. Only pure trolls and spam get flagged.

**Hard guardrails:**
- Comments mentioning specific children, mental health, abuse, or legal issues → always skipped
- Verified or high-profile accounts → flagged for Jay/Juliana to handle personally
- Anything the bot isn't confident about → skipped

## How It Learns (BrainLifts)

The bot's knowledge layer is built on BrainLifts. Each one covers a specific area:

- **Counter-Arguments** — Talking points for recurring narratives (screen time, AI, etc.). When new narratives emerge, the team adds them here and the bot learns them. If there's not enough info to address a new pushback, the bot stays silent until the BrainLift is updated.
- **Voice & Tone** — How MacKenzie sounds. Her emoji patterns, personality, banned phrases. Fed by MacKenzie's top comment answers.
- **Institutional Knowledge** — Alpha School facts (enrollment, locations, programs). Lower priority since Mary handles most info via DM.
- **Deletion Guidelines** — What to delete vs what stands. The decision tree Jay already uses.
- **Messaging Boundaries** — What the bot can and cannot say, topics that need human escalation.

The team owns these BrainLifts. When new information, questions, or pushbacks come in, you update the relevant BrainLift and the bot incorporates it. No engineering dependency.

**But the bot also learns automatically.** Beyond BrainLifts, the knowledge bank grows on its own:
- Every new IG post MacKenzie makes gets auto-ingested
- New Substack posts get pulled in weekly
- When Jay/Juliana reply to comments manually on IG, those become training data
- Every reply Jay approves in Slack becomes a positive example; every rejection or edit teaches the bot what not to do
- The bot tracks what it *can't* answer and surfaces weekly reports: "15 comments about [topic X] — not enough info to respond." That shows exactly where BrainLifts need updating.

## How Deletion Works

The bot scores each potential deletion by confidence:
- **Obvious spam** (link bots, foreign language spam) → auto-deleted, no human needed
- **Borderline cases** → sent to Slack for Jay/Juliana to approve
- **Negative opinions about Alpha** → never deleted, regardless of tone

This handles the bulk of the ~20 daily deletions automatically. Jay only sees the edge cases.

## What the Team Does

| Person | Role with the Bot |
|--------|-------------------|
| **Jay** | Primary approver (in Slack). Reviews and approves/rejects proposed replies and deletions. Maintains Deletion Guidelines BrainLift. |
| **Juliana** | Secondary approver. Same Slack workflow. |
| **MacKenzie** | Provides voice and knowledge for BrainLifts. Does NOT need to approve individual comments day-to-day. |
| **Mary** | Not involved in comment bot. DM automation (Phase 5) will eventually reduce her repetitive workload. |

All approvals happen in a **dedicated Slack channel** for this bot — not the existing Future of Education channel.

## The Rollout (6 Weeks)

| Weeks | What Happens |
|-------|-------------|
| **1-2** | Every proposed reply and deletion goes to Slack. Jay or Juliana approve, reject, or edit each one. Nothing posts automatically. |
| **3-4** | Community building replies (fun, emoji, casual) go automatic. Narrative shaping replies still need Slack approval. |
| **5-6** | Full automatic. Daily Slack digest summarizes everything the bot did. |

Edits and rejections from weeks 1-4 feed back into making the bot better.

## How It Accesses the Account

The bot uses Instagram's official Graph API — the same system that powers tools like Hootsuite and ManyChat. MacKenzie does a one-time login via Meta's secure OAuth screen (like "Sign in with Google"). No passwords are shared. Meta reviews and approves exactly what the app can do. The access token refreshes automatically.

## What's Next

**Facebook Comments** — The FB community (~200k followers) has equally active comments. Once the IG bot is working and the team is happy, we'll request additional Meta permissions and extend the same system to FB. Same AI, same BrainLifts, same Slack workflow.

**DM Automation (next phase after IG comments)** — Replaces ManyChat with a smarter system that uses MacKenzie's voice and shares the same knowledge bank. Key use case: international requests, enrollment basics, repeated FAQ responses. Requires additional Meta permissions. Uses the same AI pipeline as the comment bot, so spinning it up will be fast.

## What We Need From You

Three BrainLifts to get started:

1. **Counter-Arguments BrainLift** — For each hot narrative (screen time/Sweden, AI/kids, others): MacKenzie's key talking points, supporting sources or studies, and what should never be said.
2. **Voice & Tone BrainLift** — MacKenzie's top comment answers (Jay is already pulling this list). These become the primary training data for how the bot sounds.
3. **Deletion Guidelines BrainLift** — Jay's decision tree for what to delete vs let stand. Examples of each.
