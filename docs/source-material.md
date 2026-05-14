# Source Material

This project uses long-form source material to improve the Instagram comment bot's judgment, voice, and evaluation coverage. Raw source material should be treated differently from generated outputs: it can be committed when it is intentional project context, but it should not automatically become production knowledge.

## MacKenzie First Conversation

File: `docs/MacKenzie First Conversation.txt`

This transcript captures early strategic context from MacKenzie and Yash. It is useful for:

- Bot objectives: why Instagram replies matter, where AI should reduce manual comment work, and where Slack review remains important.
- Voice guidance: how MacKenzie thinks about warm parent/community replies versus factual information handoff.
- Product scope: adjacent needs around PR response, copywriting, website personalization, social content, VIP follower awareness, and city/community launch workflows.
- Evaluation examples: comments and scenarios that can become reviewed test cases for classification and reply quality.

Use this transcript as source material for structured artifacts:

- Add durable facts and talking points to the knowledge base only after they are verified and phrased as reusable guidance.
- Add reply-style rules to generator prompts only when they reflect a stable preference, not a one-off call detail.
- Add eval cases when the transcript clarifies a desired behavior, such as when to reply warmly, when to route to DMs, and when to avoid factual overreach.
- Keep Slack approval in the loop for generated replies; this material should improve suggestions, not authorize auto-posting.

## Eval Runs

Historical eval outputs are stored under `data/eval-runs/` when they are worth preserving as baselines. The default script outputs at `data/eval-results.json` and `data/eval-replies-results.json` are ignored because they are overwritten by local runs.

Current preserved baselines:

- `data/eval-runs/classification-2026-04-19.json`
- `data/eval-runs/replies-2026-04-03.json`

When an eval run changes a technical decision, preserve it with a dated filename and summarize the takeaway in the commit or a doc.
