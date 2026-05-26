# Comment Ingest Coverage

The bot should not silently assume it has seen every Instagram comment. Coverage now has explicit checks in both production ingestion and local scrape data.

## Production Graph API Ingest

`getRecentMediaWithStats` and `getCommentsWithStats` can page until Instagram stops returning `paging.next`, instead of being hard-coded to the first media page or first five comment pages.

The production cron uses explicit limits so the 60-second scheduled ingest cannot accidentally try to backfill the entire account on every run:

- `INGEST_MEDIA_PAGE_LIMIT`, default `1`
- `INGEST_COMMENT_PAGE_LIMIT`, default `10`
- `INGEST_REPLY_PAGE_LIMIT`, default `5`

Set any of these to `all` for a backfill-style run in a runtime with enough timeout.

The ingest cron logs:

- media pages fetched
- comment pages fetched per post
- reply pages fetched
- whether a page limit was hit
- whether `comments_count` is higher than fetched top-level comments

`daily_budgets.total_comments_seen` is now incremented when new comments are inserted, so the Slack digest should stop showing `Comments seen: 0` when new comments were actually ingested.

## Local Apify Data

Run:

```bash
npm --workspace @instagram-commenter/scripts run audit-comment-coverage -- --allow-gaps
```

This compares each post's `commentsCount` against locally observed comments. If `data/apify-raw/comments-raw.json` is missing, it falls back to `posts.latestComments`, which is only a partial sample and should show large gaps on high-comment posts.

Use the command without `--allow-gaps` in CI or a gate when local scrape completeness is required:

```bash
npm --workspace @instagram-commenter/scripts run audit-comment-coverage
```
