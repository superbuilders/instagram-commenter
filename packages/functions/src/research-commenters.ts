import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  accounts,
  commenterProfiles,
  comments,
  posts,
} from "@instagram-commenter/core/db";
import { discoverBusinessProfile } from "@instagram-commenter/core/instagram";
import { postMessage, buildRelationshipCard } from "@instagram-commenter/core/slack";
import { createCronHandler, log } from "./lib/handler.js";
import {
  getSlackBotToken,
  getSlackRelationshipChannelId,
} from "./lib/secrets.js";

const CANDIDATE_SCAN_LIMIT = 200;
const RESEARCH_CAP_PER_RUN = 8;

export const handler = createCronHandler("research-commenters", async (db) => {
  const activeAccounts = await db.select().from(accounts);

  for (const account of activeAccounts) {
    if (!account.accessToken) {
      log("warn", "Account missing access token", { accountId: account.id });
      continue;
    }

    const recent = await db
      .select({
        authorId: comments.authorId,
        authorUsername: comments.authorUsername,
        text: comments.text,
        likesCount: comments.likesCount,
        permalink: posts.permalink,
        postCaption: posts.caption,
      })
      .from(comments)
      .innerJoin(posts, eq(comments.postId, posts.id))
      .leftJoin(
        commenterProfiles,
        sql`(
          (${comments.authorId} IS NOT NULL AND ${commenterProfiles.authorId} = ${comments.authorId})
          OR ${commenterProfiles.authorUsername} = ${comments.authorUsername}
        )`
      )
      .where(
        and(
          eq(posts.accountId, account.id),
          isNotNull(comments.authorUsername),
          isNull(commenterProfiles.id)
        )
      )
      .orderBy(desc(comments.likesCount), desc(comments.commentedAt))
      .limit(CANDIDATE_SCAN_LIMIT);

    const candidates: typeof recent = [];
    const seenAuthorIds = new Set<string>();
    const seenUsernames = new Set<string>();

    for (const row of recent) {
      const username = row.authorUsername;
      if (!username) continue;
      if (username === account.username) continue;

      if (row.authorId && seenAuthorIds.has(row.authorId)) continue;
      if (seenUsernames.has(username.toLowerCase())) continue;

      candidates.push(row);
      if (row.authorId) seenAuthorIds.add(row.authorId);
      seenUsernames.add(username.toLowerCase());

      if (candidates.length >= RESEARCH_CAP_PER_RUN) break;
    }

    log("info", "Researching commenters", {
      accountId: account.id,
      scanned: recent.length,
      researching: candidates.length,
    });

    for (const candidate of candidates) {
      const username = candidate.authorUsername!;
      const result = await discoverBusinessProfile(username, {
        accessToken: account.accessToken,
        igUserId: account.platformId,
      });

      const now = new Date();
      const profileValues = {
        authorId: candidate.authorId,
        authorUsername: username,
        igBusinessId: result.status === "found" ? result.profile.id : null,
        name: result.status === "found" ? result.profile.name ?? null : null,
        biography: result.status === "found" ? result.profile.biography ?? null : null,
        website: result.status === "found" ? result.profile.website ?? null : null,
        profilePictureUrl:
          result.status === "found" ? result.profile.profile_picture_url ?? null : null,
        followersCount:
          result.status === "found" ? result.profile.followers_count ?? null : null,
        mediaCount: result.status === "found" ? result.profile.media_count ?? null : null,
        discoveryStatus: result.status,
        researchedAt: now,
        source: "graph_business_discovery",
        updatedAt: now,
      };

      const [upserted] = await db
        .insert(commenterProfiles)
        .values(profileValues)
        .onConflictDoUpdate({
          target: commenterProfiles.authorUsername,
          set: profileValues,
        })
        .returning({ id: commenterProfiles.id });

      if (result.status !== "found") {
        log("info", "Commenter not posted to relationship channel", {
          username,
          status: result.status,
          error: result.error,
        });
        continue;
      }

      try {
        const slackToken = getSlackBotToken();
        const relationshipChannelId = getSlackRelationshipChannelId();
        const card = buildRelationshipCard(
          {
            username: result.profile.username || username,
            name: result.profile.name,
            biography: result.profile.biography,
            website: result.profile.website,
            profilePictureUrl: result.profile.profile_picture_url,
            followersCount: result.profile.followers_count,
            mediaCount: result.profile.media_count,
          },
          {
            text: candidate.text,
            authorUsername: username,
            likesCount: candidate.likesCount,
            postPermalink: candidate.permalink,
            postCaption: candidate.postCaption,
          }
        );

        const ts = await postMessage(
          relationshipChannelId,
          card.blocks,
          card.text,
          slackToken
        );

        await db
          .update(commenterProfiles)
          .set({ slackMessageTs: ts, updatedAt: new Date() })
          .where(eq(commenterProfiles.id, upserted.id));
      } catch (err) {
        log("error", "Failed to post relationship card", {
          username,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
});
