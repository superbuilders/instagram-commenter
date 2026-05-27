# Instagram Comment Bot

This context describes the product language for the Instagram comment assistant. It exists so reply selection, grounding, Slack review, and learning-loop work use the same terms.

## Language

**Bio Link Inventory**:
The current set of destinations reachable from MacKenzie's Instagram link in bio.
_Avoid_: Linktree, bio link, links in bio

**Bio Destination**:
A single current page, form, or resource inside the **Bio Link Inventory**.
_Avoid_: Link, CTA, resource

**Bio Destination Snapshot**:
The saved title, URL, visible text, and fetch metadata for a **Bio Destination** at a point in time.
_Avoid_: Scrape, cache, page copy

**Verified Knowledge**:
Approved source material that can ground factual claims in a reply.
_Avoid_: Context, content, source

**Post Context**:
The caption, transcript, and metadata for the specific Instagram post a comment appears under.
_Avoid_: Caption, video context

**Post Context Job**:
The tracked attempt to enrich one Instagram video post with transcript and metadata from Apify.
_Avoid_: Apify run, scrape job, transcript job

**Visual Context**:
Future on-screen text or frame-level understanding for a video post.
_Avoid_: Video context, frame analysis, OCR

**Knowledge Gap Inventory**:
The grouped set of unanswered comment needs where the system could not find enough **Verified Knowledge**, **Bio Destination Snapshot**, or **Post Context** to respond confidently.
_Avoid_: Gap log, missing info, skipped comments

**Slack Review Card**:
The Slack message where a human reviews one proposed reply and chooses approve, edit, or reject.
_Avoid_: Card, Slack item, bot message

## Relationships

- A **Bio Link Inventory** contains one or more **Bio Destinations**.
- A **Bio Destination** can be used as **Verified Knowledge** only after it has a recent enough **Bio Destination Snapshot**.
- A **Bio Destination** may reuse an existing **Bio Destination Snapshot** when the URL is already known and the snapshot is not stale.
- A **Bio Destination Snapshot** is treated as relatively stable unless the destination is new, the link changes, the content hash changes, or the system cannot find the information needed for a reply.
- A **Post Context** belongs to exactly one Instagram post.
- A **Post Context Job** belongs to exactly one video post and produces one **Post Context** when successful.
- **Visual Context** is intentionally outside the first **Post Context** implementation.
- A **Knowledge Gap Inventory** groups comments by the missing information needed to answer them.
- A **Slack Review Card** should show which **Verified Knowledge**, **Bio Destination**, or **Post Context** grounded the proposed reply.

## Example Dialogue

> **Dev:** "Can the bot say `link in bio` for this teacher hiring question?"
> **Domain expert:** "Only if today's **Bio Link Inventory** includes a relevant **Bio Destination**, like a current guide application page, and the **Slack Review Card** shows that evidence."

## Flagged Ambiguities

- "link in bio" was used both as a generic CTA phrase and as a possible source of current information. Resolved: use **Bio Link Inventory** for the current directory of destinations, and **Bio Destination** for a specific matched page or form.
- "scrape the link" was used to mean both discovering available destinations and fetching page content. Resolved: **Bio Link Inventory** discovery runs daily, while **Bio Destination Snapshot** fetches can be reused for known stable destinations.
- "knowledge gaps" should not mean only aggregate skip counts. Resolved: use **Knowledge Gap Inventory** for grouped missing information with representative comments and the source material needed to fill the gap.
