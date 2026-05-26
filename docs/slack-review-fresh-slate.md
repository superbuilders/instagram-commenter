# Slack Review Fresh Slate

This repo now has two safe operations paths for starting `#foe-bot` from a cleaner slate without clicking Approve/Edit/Reject.

## Option 1: Retire Old Pending Reviews

`packages/scripts/src/clear-slack-review-slate.ts` finds pending reply records that already have a Slack message and are older than a chosen cutoff.

In dry-run mode it only prints matching rows.

In apply mode it marks those reply records as:

- `approvalStatus = rejected`
- `reviewOutcomeReason = other`
- `reviewOutcomeCategory = operator`
- `reviewOutcomeNotes = stale_review_reset...`

By default it does not:

- delete Slack messages
- update Slack cards
- post or reject Instagram replies through the Slack interaction flow
- ingest those stale replies as negative training examples

If `--delete-slack-messages` is provided with `--apply`, it also calls Slack `chat.delete` for each stale pending review card using the stored `slackMessageTs`. This is the path that makes `#foe-bot` visually clean. It depends on the Slack bot token having permission to delete its own messages.

The Slack approval handler now ignores approve/edit/reject interactions for replies that are no longer pending, so old buttons cannot accidentally revive a retired card.

### Commands

Dry run:

```bash
npm --workspace @instagram-commenter/scripts run clear-slack-review-slate -- --older-than-hours 24 --limit 100
```

Apply:

```bash
npm --workspace @instagram-commenter/scripts run clear-slack-review-slate -- --older-than-hours 24 --limit 100 --apply
```

Apply and remove the matching bot cards from Slack:

```bash
npm --workspace @instagram-commenter/scripts run clear-slack-review-slate -- --channel-id C0AT168EGCU --older-than-hours 24 --limit 100 --apply --delete-slack-messages
```

Use `--older-than-hours 1` for a tighter reset window, or raise `--limit` for larger backlogs.

## Option 2: Delete Bot Messages By Channel History

`packages/scripts/src/prune-slack-bot-messages.ts` makes the channel visually clean by deleting bot-authored Slack messages. It uses the Slack bot token, so it can only delete messages the bot is allowed to delete. It does not delete human messages.

This option requires Slack history scopes on the bot token. In the current environment, the dry run failed with `missing_scope`, so Option 1 is more likely to work because it uses message timestamps already stored in the DB.

Dry run:

```bash
npm --workspace @instagram-commenter/scripts run prune-slack-bot-messages -- --channel-id C0AT168EGCU --limit 200
```

Apply:

```bash
npm --workspace @instagram-commenter/scripts run prune-slack-bot-messages -- --channel-id C0AT168EGCU --limit 200 --apply
```

Useful scoped variants:

```bash
# Delete only messages before a Slack timestamp
npm --workspace @instagram-commenter/scripts run prune-slack-bot-messages -- --channel-id C0AT168EGCU --before-ts 1779458418.136219 --limit 200 --apply

# Delete only messages after a Slack timestamp
npm --workspace @instagram-commenter/scripts run prune-slack-bot-messages -- --channel-id C0AT168EGCU --after-ts 1779450000.000000 --limit 200 --apply
```

## Expected Result

After applying option 1, the allocator will stop treating retired replies as pending work.

After applying option 2, old bot-authored cards disappear from Slack. New cards should be dominated less by stale community-building clutter because the allocator now filters low-value community comments and prioritizes narrative/informational items.
