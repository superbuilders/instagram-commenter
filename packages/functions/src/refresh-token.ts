import { eq, lte, and, isNotNull } from "drizzle-orm";
import { accounts } from "@instagram-commenter/core/db";
import { refreshLongLivedToken } from "@instagram-commenter/core/instagram";
import { postMessage } from "@instagram-commenter/core/slack";
import { createCronHandler, log } from "./lib/handler.js";
import { getSlackBotToken, getSlackChannelId } from "./lib/secrets.js";

export const handler = createCronHandler("refresh-token", async (db) => {
  const sevenDaysFromNow = new Date();
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

  const expiring = await db
    .select()
    .from(accounts)
    .where(
      and(
        isNotNull(accounts.tokenExpiresAt),
        lte(accounts.tokenExpiresAt, sevenDaysFromNow)
      )
    );

  if (expiring.length === 0) {
    log("info", "No tokens expiring soon");
    return;
  }

  for (const account of expiring) {
    if (!account.accessToken) continue;

    try {
      const result = await refreshLongLivedToken(account.accessToken);
      const newExpiry = new Date();
      newExpiry.setSeconds(newExpiry.getSeconds() + result.expires_in);

      await db
        .update(accounts)
        .set({
          accessToken: result.access_token,
          tokenExpiresAt: newExpiry,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, account.id));

      log("info", "Token refreshed", {
        accountId: account.id,
        expiresAt: newExpiry.toISOString(),
      });
    } catch (err) {
      log("error", "Token refresh failed", {
        accountId: account.id,
        error: err instanceof Error ? err.message : String(err),
      });

      // Alert via Slack
      try {
        const slackToken = getSlackBotToken();
        const channelId = getSlackChannelId();
        await postMessage(
          channelId,
          [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `⚠️ *Token refresh failed* for @${account.username}. Manual re-auth may be needed.`,
              },
            },
          ],
          "Token refresh failed",
          slackToken
        );
      } catch {
        // Slack alert failed too — just log
      }
    }
  }
});
