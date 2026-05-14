# Jay Call — Talking Points

## The One-Liner

We built a system that reads MacKenzie's Instagram comments, figures out which ones deserve a response, writes a reply in her voice, and sends it to you in Slack to approve before anything gets posted.

---

## What We Built (Plain English)

**The bot does three things:**

1. **Responds to comments in MacKenzie's voice** — community replies (emoji, encouragement, casual Q&A) and substantive replies when someone challenges Alpha on screen time, AI, etc.
2. **Answers factual questions** — enrollment, locations, programs. Reduces the load on Mary's DM team.
3. **Flags spam and trolls for deletion** — the ~20/day you're already deleting. Obvious spam gets auto-deleted. Borderline stuff comes to you in Slack first. Legitimate criticism is never touched.

**How it knows what to say:**

We trained it on MacKenzie's actual voice — 182 of her real comment replies, 33 podcast transcripts where she speaks at length, all her IG captions, and her Substack posts. The bot doesn't make things up. If it doesn't have enough knowledge to respond to something, it stays quiet.

**How you control it:**

Everything goes through Slack. You see the original comment, the bot's proposed reply, and three buttons: Approve, Edit, or Reject. If you edit, the bot learns from your correction. If you reject, it learns what not to say. Over time it gets better because of your input.

---

## What's Done

- The entire system is built and deployed on AWS
- Knowledge bank is loaded with MacKenzie's voice data
- The AI classifier works — we tested it on 10 different comment types and it got all 10 right
- Slack is connected — you'll get messages in a dedicated channel
- The daily budget system is built — 10-15 replies on a normal day, 30-40 on big days

## What's NOT Done Yet

- **MacKenzie needs to click one link** to connect her IG account. Without that, the bot can't see comments. It's a 30-second thing — she clicks a link, selects @futureof_education, done.
- **BrainLifts** — the knowledge documents you and MacKenzie maintain. The bot has her voice from podcasts and past replies, but it doesn't have your specific talking points for narratives, your deletion rules, or messaging boundaries. These live in WorkFlowy — the team updates them there and the bot picks up changes automatically.
- **Your review of 110 comments** — we have an HTML page with 110 real comments from the account, each pre-classified by the AI. We need you to scan through and correct any the AI got wrong. Takes ~15 minutes. This is how we prove the AI's judgment matches yours.

---

## The Rollout

| Weeks | What Happens |
|-------|-------------|
| **1-2** | Every reply and deletion comes to you in Slack first. Nothing posts without your approval. |
| **3-4** | Easy stuff (community replies, emoji, casual) goes automatic. Narrative replies still need you. |
| **5-6** | Full auto. You get a daily digest summarizing what the bot did. |

You and Juliana can always override anything. The Slack channel is your control panel.

---

## What We Need From Jay

1. **MacKenzie to click the OAuth link** (Yash will send it)
2. **Counter-Arguments BrainLift** — your talking points for screen time, AI in education, and other recurring pushback
3. **Voice & Tone BrainLift** — the top comment answers you've been pulling
4. **Deletion Guidelines** — your decision tree for what to delete vs let stand
5. **15 minutes reviewing the eval page** — scan 110 comments, confirm or correct the AI's classifications

---

## Questions Jay Might Ask

**"How does the bot decide which comments to respond to?"**
It reads every comment and classifies it: is this someone challenging Alpha on a narrative? Is this a community moment worth responding to? Is this an enrollment question? Is this spam? Then it picks the highest-impact ones within a daily budget — narrative shaping first (highest visibility), then community, then informational.

**"What if it says something wrong?"**
During weeks 1-2, nothing posts without your approval. After that, if it doesn't have enough knowledge to respond confidently, it stays silent. It never improvises on sensitive topics. And every time you correct it, it learns.

**"What about the deletion side?"**
Same Slack workflow. High-confidence spam gets auto-deleted. Medium-confidence comes to you with a Delete/Skip button. Negative opinions about Alpha are never flagged for deletion — only pure trolls and spam.

**"Where do BrainLifts live?"**
WorkFlowy. The team edits them there like any other document. The system checks for changes every hour and automatically updates. No engineering needed to update content.

**"How does this affect Mary?"**
The bot handles common factual questions in the comments (enrollment, locations). Complex stuff still goes to Mary via DMs. Over time this should reduce her repetitive workload.
