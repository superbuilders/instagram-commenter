import { createHash } from "node:crypto";

export type BioDestinationStatus = "active" | "removed";
export type BioSnapshotFetchStatus = "succeeded" | "failed";

export interface BioDestinationLink {
  title: string;
  url: string;
}

export interface BioPageFetchResult {
  title: string;
  visibleText: string;
  links: BioDestinationLink[];
}

export interface BioLinkInventoryInput {
  accountId: string;
  profileUsername: string;
  bioUrl: string;
}

export interface BioLinkInventory {
  accountId: string;
  profileUsername: string;
  sourceUrl: string;
  refreshedAt: Date;
}

export interface BioDestination {
  id: string;
  accountId: string;
  title: string;
  url: string;
  status: BioDestinationStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface BioDestinationSnapshot {
  id: string;
  destinationId: string;
  title: string;
  url: string;
  visibleText: string;
  contentHash: string;
  fetchStatus: BioSnapshotFetchStatus;
  fetchedAt: Date;
  errorMessage?: string;
}

type MaybePromise<T> = T | Promise<T>;

export interface BioLinkStore {
  upsertInventory(inventory: BioLinkInventory): Promise<void>;
  getInventory(accountId: string): MaybePromise<BioLinkInventory | undefined>;
  listDestinations(accountId: string): MaybePromise<BioDestination[]>;
  upsertDestination(input: {
    accountId: string;
    title: string;
    url: string;
    seenAt: Date;
  }): Promise<BioDestination>;
  markRemoved(accountId: string, currentUrls: Set<string>, removedAt: Date): Promise<number>;
  latestSnapshot(destinationId: string): MaybePromise<BioDestinationSnapshot | undefined>;
  addSnapshot(snapshot: Omit<BioDestinationSnapshot, "id">): Promise<BioDestinationSnapshot>;
  listSnapshots(destinationId: string): MaybePromise<BioDestinationSnapshot[]>;
}

export interface BioRefreshReport {
  inventoryUrl: string;
  destinations: {
    new: number;
    changed: number;
    reused: number;
    failed: number;
    removed: number;
  };
}

export interface RefreshBioLinkInventoryOptions {
  store: BioLinkStore;
  fetchPage: (url: string) => Promise<BioPageFetchResult>;
  now?: Date;
  snapshotFreshForMs?: number;
}

function hashContent(input: Pick<BioPageFetchResult, "title" | "visibleText">): string {
  return createHash("sha256")
    .update(`${input.title}\n${input.visibleText}`)
    .digest("hex");
}

export async function refreshBioLinkInventory(
  input: BioLinkInventoryInput,
  opts: RefreshBioLinkInventoryOptions
): Promise<BioRefreshReport> {
  const now = opts.now ?? new Date();
  const report: BioRefreshReport = {
    inventoryUrl: input.bioUrl,
    destinations: {
      new: 0,
      changed: 0,
      reused: 0,
      failed: 0,
      removed: 0,
    },
  };

  const inventoryPage = await opts.fetchPage(input.bioUrl);
  await opts.store.upsertInventory({
    accountId: input.accountId,
    profileUsername: input.profileUsername,
    sourceUrl: input.bioUrl,
    refreshedAt: now,
  });

  const currentUrls = new Set(inventoryPage.links.map((link) => link.url));

  for (const link of inventoryPage.links) {
    const existing = (await opts.store.listDestinations(input.accountId))
      .find((destination) => destination.url === link.url);
    const destination = await opts.store.upsertDestination({
      accountId: input.accountId,
      title: link.title,
      url: link.url,
      seenAt: now,
    });

    const previousSnapshot = await opts.store.latestSnapshot(destination.id);
    if (
      previousSnapshot?.fetchStatus === "succeeded" &&
      opts.snapshotFreshForMs != null &&
      now.getTime() - previousSnapshot.fetchedAt.getTime() <= opts.snapshotFreshForMs
    ) {
      report.destinations.reused++;
      continue;
    }

    try {
      const page = await opts.fetchPage(link.url);
      const contentHash = hashContent(page);

      if (
        previousSnapshot?.fetchStatus === "succeeded" &&
        previousSnapshot.contentHash === contentHash
      ) {
        report.destinations.reused++;
        continue;
      }

      await opts.store.addSnapshot({
        destinationId: destination.id,
        title: page.title,
        url: link.url,
        visibleText: page.visibleText,
        contentHash,
        fetchStatus: "succeeded",
        fetchedAt: now,
      });

      if (existing) {
        report.destinations.changed++;
      } else {
        report.destinations.new++;
      }
    } catch (err) {
      report.destinations.failed++;
      await opts.store.addSnapshot({
        destinationId: destination.id,
        title: link.title,
        url: link.url,
        visibleText: "",
        contentHash: "",
        fetchStatus: "failed",
        fetchedAt: now,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  report.destinations.removed = await opts.store.markRemoved(
    input.accountId,
    currentUrls,
    now
  );

  return report;
}

export function createMemoryBioLinkStore(): BioLinkStore {
  let nextId = 1;
  const inventories = new Map<string, BioLinkInventory>();
  const destinations = new Map<string, BioDestination>();
  const snapshots = new Map<string, BioDestinationSnapshot[]>();

  function id(prefix: string): string {
    return `${prefix}-${nextId++}`;
  }

  return {
    async upsertInventory(inventory) {
      inventories.set(inventory.accountId, inventory);
    },
    getInventory(accountId) {
      return inventories.get(accountId);
    },
    listDestinations(accountId) {
      return [...destinations.values()].filter((d) => d.accountId === accountId);
    },
    async upsertDestination(input) {
      const existing = [...destinations.values()].find(
        (d) => d.accountId === input.accountId && d.url === input.url
      );
      if (existing) {
        existing.title = input.title;
        existing.status = "active";
        existing.lastSeenAt = input.seenAt;
        return existing;
      }

      const destination: BioDestination = {
        id: id("destination"),
        accountId: input.accountId,
        title: input.title,
        url: input.url,
        status: "active",
        firstSeenAt: input.seenAt,
        lastSeenAt: input.seenAt,
      };
      destinations.set(destination.id, destination);
      return destination;
    },
    async markRemoved(accountId, currentUrls, removedAt) {
      let count = 0;
      for (const destination of destinations.values()) {
        if (
          destination.accountId === accountId &&
          destination.status === "active" &&
          !currentUrls.has(destination.url)
        ) {
          destination.status = "removed";
          destination.lastSeenAt = removedAt;
          count++;
        }
      }
      return count;
    },
    latestSnapshot(destinationId) {
      return snapshots.get(destinationId)?.at(-1);
    },
    async addSnapshot(input) {
      const snapshot: BioDestinationSnapshot = {
        id: id("snapshot"),
        ...input,
      };
      const existing = snapshots.get(input.destinationId) ?? [];
      existing.push(snapshot);
      snapshots.set(input.destinationId, existing);
      return snapshot;
    },
    listSnapshots(destinationId) {
      return snapshots.get(destinationId) ?? [];
    },
  };
}
