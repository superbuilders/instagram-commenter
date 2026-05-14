# Email Draft — Reply to Jay

**To**: Jay Lyons
**CC**: MacKenzie Price, Juliana Lyons, Chris Mass, Haven Mass
**Subject**: RE: IG MacKenzie Comment Bot

---

Jay,

Thank you for the detailed feedback — this is exactly what I needed. Your reframe on community building vs. narrative shaping completely changed how I'm approaching this. I've reworked the entire design around those two pillars.

I've attached a one-pager overview of how the system works (non-technical). Below is the updated approach addressing each of your points.

---

**Purpose (updated)**
Two jobs, per your notes:
1. Community Building — personal touch from MacKenzie. Fun, lighthearted, emoji, encouragement, commiseration with fellow parents, casual Q&A. Making followers feel seen.
2. Narrative Shaping (highest priority) — MacKenzie weighing in on high-visibility threads to counter misinformation. Screen time/Sweden, AI in education, and whatever emerges next. Succinct, factual, never defensive.

The bot will NOT replace the DM system. Mary's work stays untouched.

---

**Training Data & BrainLifts**
The bot's knowledge comes from BrainLifts — and this is the key design decision: if a topic isn't covered in a BrainLift, the bot stays quiet. It never guesses. This means as new narratives, pushbacks, and questions keep coming, the team updates the relevant BrainLift and the bot learns it. No dependency on me for knowledge updates. If there's not enough info to address a particular comment, it simply won't respond.

I need three BrainLifts to get started:
- **Counter-Arguments BrainLift** — covering the hot narratives (screen time/Sweden, AI in education, and any others you're seeing). Key talking points, sources/studies MacKenzie references, and what should never be said per topic.
- **Voice & Tone BrainLift** — MacKenzie's top comment answers from the list you're already pulling. These become the highest-weight training data.
- **Deletion Guidelines BrainLift** — your decision tree for what to delete vs what stands.

Our existing content (IG captions, MacKenzie's 182 comment replies from the scrape, Substack, website) feeds in as baseline knowledge alongside the BrainLifts.

---

**Decision Logic (updated)**
Every comment runs through a four-way classifier:
- **Narrative shaping** — high-visibility thread touching a hot topic → bot responds with BrainLift-backed counter-arguments. Highest priority.
- **Community building** — positive, casual, personal → bot responds with MacKenzie's lighthearted voice.
- **Delete** — troll, spam, bad-faith actors → flagged for deletion. Important: negative opinions and criticism are NEVER deleted, even if hostile. Only pure trolls and spam.
- **Skip** — everything else, no action.

---

**Timing (updated per your feedback)**
You're right — late replies aren't unnatural, and responding to everything would be. I've removed the time-window approach entirely.

New model: daily reply budget.
- Normal day (~150 comments): 10-15 bot replies
- Big day (300+ comments): 30-40 replies
- Narrative shaping comments get priority, then community building
- Spread across the day, not batched
- No post-age cutoff — months-old videos still get engagement

---

**Comment Deletion (confidence-scored)**
Built in. The classifier scores each deletion candidate by confidence:
- Obvious spam/link bots (high confidence) → auto-deleted immediately, no human needed
- Borderline cases → sent to Slack for your approval
- Anything that looks like real feedback, even negative → never deleted, regardless of tone

This should handle the bulk of your ~20 daily deletions automatically from day one. You'll only see the edge cases in Slack.

---

**Rollout (6 weeks, per your request)**
- Weeks 1-2: Every reply and deletion goes to Slack. You or Juliana approve/reject/edit. Nothing auto-posts.
- Weeks 3-4: Community building replies go auto. Narrative shaping stays in approval.
- Weeks 5-6: Full auto. Daily digest of everything posted.

I'll set up a dedicated Slack channel for this — not the existing FoE channel. You and Juliana are the approvers.

One thing worth calling out: **the bot learns from your corrections.** Every time you approve a reply, it becomes a positive training example. Every time you reject or edit one, the bot learns what not to do and what to do instead. So during those first few weeks, you're not just approving — you're actively teaching the system. It gets better because of your feedback, not in spite of it.

You'll also get a weekly report showing what the bot *couldn't* answer — comments it skipped because it didn't have enough information. That shows exactly where the BrainLifts need updating.

---

**FB, DMs & ManyChat**
Good news on all three.

The system is built on Meta's Graph API, which covers both IG and FB. Once the IG comment bot is working and you're happy with it, I'll request additional permissions from Meta for FB comments and DMs — same review process, no extra work from your side.

For DMs: our system will eventually replace ManyChat entirely with something smarter that uses MacKenzie's voice. The international request response you mentioned is a perfect first use case. DM automation is the next phase right after IG comments — it shares the same knowledge base and AI pipeline, so spinning it up will be fast once the comment bot is running.

**How the bot accesses the account**: It uses Instagram's official Graph API — same system as Hootsuite, Later, ManyChat. MacKenzie does a one-time login via Meta's secure OAuth screen. No passwords shared with us. Meta reviews and approves exactly what the app can do.

---

**What I Need From You**

BrainLifts (you know the format):
1. Counter-Arguments BrainLift — hot narratives + talking points
2. Voice & Tone BrainLift — MacKenzie's top comment answers from your list
3. Deletion Guidelines BrainLift — your decision tree

Questions:
1. What ManyChat flows are you setting up and what's the timeline? Want to make sure nothing conflicts during transition.
2. Is the FB comment culture different from IG? Same team managing it?
3. Can you walk me through what triggers a delete vs letting a negative comment stand? (This feeds directly into the Deletion Guidelines BrainLift.)

Happy to jump on a call this week to walk through any of this — especially the BrainLifts. Might be fastest to do those live.

Create Serendipity,
Yash Chitneni
