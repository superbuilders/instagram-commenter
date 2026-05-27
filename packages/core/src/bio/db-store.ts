import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/index.js";
import {
  bioDestinationSnapshots,
  bioDestinations,
  bioLinkInventories,
} from "../db/schema.js";
import type {
  BioDestination,
  BioDestinationSnapshot,
  BioLinkInventory,
  BioLinkStore,
} from "./refresh.js";

function toInventory(row: typeof bioLinkInventories.$inferSelect): BioLinkInventory {
  return {
    accountId: row.accountId,
    profileUsername: row.profileUsername,
    sourceUrl: row.sourceUrl,
    refreshedAt: row.refreshedAt,
  };
}

function toDestination(row: typeof bioDestinations.$inferSelect): BioDestination {
  return {
    id: row.id,
    accountId: row.accountId,
    title: row.title,
    url: row.url,
    status: row.status as BioDestination["status"],
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
  };
}

function toSnapshot(
  row: typeof bioDestinationSnapshots.$inferSelect
): BioDestinationSnapshot {
  return {
    id: row.id,
    destinationId: row.destinationId,
    title: row.title,
    url: row.url,
    visibleText: row.visibleText,
    contentHash: row.contentHash,
    fetchStatus: row.fetchStatus as BioDestinationSnapshot["fetchStatus"],
    fetchedAt: row.fetchedAt,
    errorMessage: row.errorMessage ?? undefined,
  };
}

export function createDbBioLinkStore(db: Database): BioLinkStore {
  return {
    async upsertInventory(inventory) {
      await db
        .insert(bioLinkInventories)
        .values({
          accountId: inventory.accountId,
          profileUsername: inventory.profileUsername,
          sourceUrl: inventory.sourceUrl,
          refreshedAt: inventory.refreshedAt,
          updatedAt: inventory.refreshedAt,
        })
        .onConflictDoUpdate({
          target: bioLinkInventories.accountId,
          set: {
            profileUsername: inventory.profileUsername,
            sourceUrl: inventory.sourceUrl,
            refreshedAt: inventory.refreshedAt,
            updatedAt: inventory.refreshedAt,
          },
        });
    },
    async getInventory(accountId) {
      const [row] = await db
        .select()
        .from(bioLinkInventories)
        .where(eq(bioLinkInventories.accountId, accountId))
        .limit(1);
      return row ? toInventory(row) : undefined;
    },
    async listDestinations(accountId) {
      const rows = await db
        .select()
        .from(bioDestinations)
        .where(eq(bioDestinations.accountId, accountId));
      return rows.map(toDestination);
    },
    async upsertDestination(input) {
      const [row] = await db
        .insert(bioDestinations)
        .values({
          accountId: input.accountId,
          title: input.title,
          url: input.url,
          status: "active",
          firstSeenAt: input.seenAt,
          lastSeenAt: input.seenAt,
          updatedAt: input.seenAt,
        })
        .onConflictDoUpdate({
          target: [bioDestinations.accountId, bioDestinations.url],
          set: {
            title: input.title,
            status: "active",
            lastSeenAt: input.seenAt,
            updatedAt: input.seenAt,
          },
        })
        .returning();
      return toDestination(row);
    },
    async markRemoved(accountId, currentUrls, removedAt) {
      const activeDestinations = await db
        .select()
        .from(bioDestinations)
        .where(
          and(
            eq(bioDestinations.accountId, accountId),
            eq(bioDestinations.status, "active")
          )
        );

      const removed = activeDestinations.filter((destination) =>
        !currentUrls.has(destination.url)
      );

      for (const destination of removed) {
        await db
          .update(bioDestinations)
          .set({
            status: "removed",
            lastSeenAt: removedAt,
            updatedAt: removedAt,
          })
          .where(eq(bioDestinations.id, destination.id));
      }

      return removed.length;
    },
    async latestSnapshot(destinationId) {
      const [row] = await db
        .select()
        .from(bioDestinationSnapshots)
        .where(eq(bioDestinationSnapshots.destinationId, destinationId))
        .orderBy(desc(bioDestinationSnapshots.fetchedAt))
        .limit(1);
      return row ? toSnapshot(row) : undefined;
    },
    async addSnapshot(snapshot) {
      const [row] = await db
        .insert(bioDestinationSnapshots)
        .values({
          destinationId: snapshot.destinationId,
          title: snapshot.title,
          url: snapshot.url,
          visibleText: snapshot.visibleText,
          contentHash: snapshot.contentHash,
          fetchStatus: snapshot.fetchStatus,
          fetchedAt: snapshot.fetchedAt,
          errorMessage: snapshot.errorMessage ?? null,
        })
        .returning();
      return toSnapshot(row);
    },
    async listSnapshots(destinationId) {
      const rows = await db
        .select()
        .from(bioDestinationSnapshots)
        .where(eq(bioDestinationSnapshots.destinationId, destinationId))
        .orderBy(sql`${bioDestinationSnapshots.fetchedAt} asc`);
      return rows.map(toSnapshot);
    },
  };
}
