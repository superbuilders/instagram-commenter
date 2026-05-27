import { describe, expect, test } from "vitest";
import {
  createMemoryBioLinkStore,
  refreshBioLinkInventory,
  type BioPageFetchResult,
} from "../refresh.js";

function fetcher(pages: Record<string, BioPageFetchResult>) {
  return async (url: string) => {
    const page = pages[url];
    if (!page) throw new Error(`Unexpected fetch: ${url}`);
    return page;
  };
}

function countingFetcher(pages: Record<string, BioPageFetchResult>) {
  const calls = new Map<string, number>();
  const fetchPage = async (url: string) => {
    calls.set(url, (calls.get(url) ?? 0) + 1);
    const page = pages[url];
    if (!page) throw new Error(`Unexpected fetch: ${url}`);
    return page;
  };
  return { fetchPage, calls };
}

describe("refreshBioLinkInventory", () => {
  test("discovers a new Bio Destination and saves a Bio Destination Snapshot", async () => {
    const store = createMemoryBioLinkStore();
    const now = new Date("2026-05-26T15:00:00.000Z");

    const report = await refreshBioLinkInventory(
      {
        accountId: "account-1",
        profileUsername: "futureof_education",
        bioUrl: "https://linktr.ee/futureof_education",
      },
      {
        store,
        now,
        fetchPage: fetcher({
          "https://linktr.ee/futureof_education": {
            title: "Future of Education",
            visibleText: "Alpha Anywhere Become a Guide",
            links: [
              {
                title: "Alpha Anywhere",
                url: "https://alpha.school/anywhere",
              },
            ],
          },
          "https://alpha.school/anywhere": {
            title: "Alpha Anywhere",
            visibleText: "Alpha Anywhere is a virtual school program.",
            links: [],
          },
        }),
      }
    );

    expect(report.destinations).toEqual({
      new: 1,
      changed: 0,
      reused: 0,
      failed: 0,
      removed: 0,
    });

    const inventory = await store.getInventory("account-1");
    expect(inventory?.sourceUrl).toBe("https://linktr.ee/futureof_education");
    expect(inventory?.profileUsername).toBe("futureof_education");

    const destinations = await store.listDestinations("account-1");
    expect(destinations).toHaveLength(1);
    expect(destinations[0]).toMatchObject({
      title: "Alpha Anywhere",
      url: "https://alpha.school/anywhere",
      status: "active",
    });

    const snapshots = await store.listSnapshots(destinations[0].id);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      title: "Alpha Anywhere",
      visibleText: "Alpha Anywhere is a virtual school program.",
      fetchStatus: "succeeded",
      fetchedAt: now,
    });
    expect(snapshots[0].contentHash).toHaveLength(64);
  });

  test("reuses a fresh Bio Destination Snapshot without refetching a known stable destination", async () => {
    const store = createMemoryBioLinkStore();
    const firstRun = new Date("2026-05-26T15:00:00.000Z");
    const secondRun = new Date("2026-05-27T15:00:00.000Z");
    const pages = {
      "https://linktr.ee/futureof_education": {
        title: "Future of Education",
        visibleText: "Alpha Anywhere",
        links: [
          {
            title: "Alpha Anywhere",
            url: "https://alpha.school/anywhere",
          },
        ],
      },
      "https://alpha.school/anywhere": {
        title: "Alpha Anywhere",
        visibleText: "Alpha Anywhere is a virtual school program.",
        links: [],
      },
    };

    const firstFetcher = countingFetcher(pages);
    await refreshBioLinkInventory(
      {
        accountId: "account-1",
        profileUsername: "futureof_education",
        bioUrl: "https://linktr.ee/futureof_education",
      },
      { store, now: firstRun, fetchPage: firstFetcher.fetchPage }
    );

    const secondFetcher = countingFetcher(pages);
    const report = await refreshBioLinkInventory(
      {
        accountId: "account-1",
        profileUsername: "futureof_education",
        bioUrl: "https://linktr.ee/futureof_education",
      },
      {
        store,
        now: secondRun,
        snapshotFreshForMs: 14 * 24 * 60 * 60 * 1000,
        fetchPage: secondFetcher.fetchPage,
      }
    );

    expect(report.destinations).toMatchObject({
      new: 0,
      changed: 0,
      reused: 1,
    });
    expect(secondFetcher.calls.get("https://linktr.ee/futureof_education")).toBe(1);
    expect(secondFetcher.calls.get("https://alpha.school/anywhere")).toBeUndefined();

    const [destination] = await store.listDestinations("account-1");
    expect(await store.listSnapshots(destination.id)).toHaveLength(1);
  });

  test("creates a new Bio Destination Snapshot when stale destination content changes", async () => {
    const store = createMemoryBioLinkStore();
    const firstRun = new Date("2026-05-01T15:00:00.000Z");
    const secondRun = new Date("2026-05-26T15:00:00.000Z");
    const bioPage = {
      title: "Future of Education",
      visibleText: "Alpha Anywhere",
      links: [{ title: "Alpha Anywhere", url: "https://alpha.school/anywhere" }],
    };

    await refreshBioLinkInventory(
      {
        accountId: "account-1",
        profileUsername: "futureof_education",
        bioUrl: "https://linktr.ee/futureof_education",
      },
      {
        store,
        now: firstRun,
        fetchPage: fetcher({
          "https://linktr.ee/futureof_education": bioPage,
          "https://alpha.school/anywhere": {
            title: "Alpha Anywhere",
            visibleText: "Old Alpha Anywhere page text.",
            links: [],
          },
        }),
      }
    );

    const report = await refreshBioLinkInventory(
      {
        accountId: "account-1",
        profileUsername: "futureof_education",
        bioUrl: "https://linktr.ee/futureof_education",
      },
      {
        store,
        now: secondRun,
        snapshotFreshForMs: 14 * 24 * 60 * 60 * 1000,
        fetchPage: fetcher({
          "https://linktr.ee/futureof_education": bioPage,
          "https://alpha.school/anywhere": {
            title: "Alpha Anywhere",
            visibleText: "Updated Alpha Anywhere page text.",
            links: [],
          },
        }),
      }
    );

    expect(report.destinations).toMatchObject({
      new: 0,
      changed: 1,
      reused: 0,
    });

    const [destination] = await store.listDestinations("account-1");
    const snapshots = await store.listSnapshots(destination.id);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].visibleText).toBe("Updated Alpha Anywhere page text.");
  });

  test("records failed destination fetches without failing the whole inventory refresh", async () => {
    const store = createMemoryBioLinkStore();

    const report = await refreshBioLinkInventory(
      {
        accountId: "account-1",
        profileUsername: "futureof_education",
        bioUrl: "https://linktr.ee/futureof_education",
      },
      {
        store,
        now: new Date("2026-05-26T15:00:00.000Z"),
        fetchPage: async (url) => {
          if (url === "https://linktr.ee/futureof_education") {
            return {
              title: "Future of Education",
              visibleText: "Become a Guide",
              links: [
                {
                  title: "Become a Guide",
                  url: "https://alpha.school/guides",
                },
              ],
            };
          }
          throw new Error("timeout");
        },
      }
    );

    expect(report.destinations.failed).toBe(1);
    const [destination] = await store.listDestinations("account-1");
    const [snapshot] = await store.listSnapshots(destination.id);
    expect(snapshot).toMatchObject({
      fetchStatus: "failed",
      errorMessage: "timeout",
    });
  });

  test("marks destinations removed when they disappear from the current Bio Link Inventory", async () => {
    const store = createMemoryBioLinkStore();
    const input = {
      accountId: "account-1",
      profileUsername: "futureof_education",
      bioUrl: "https://linktr.ee/futureof_education",
    };

    await refreshBioLinkInventory(input, {
      store,
      now: new Date("2026-05-26T15:00:00.000Z"),
      fetchPage: fetcher({
        "https://linktr.ee/futureof_education": {
          title: "Future of Education",
          visibleText: "Alpha Anywhere",
          links: [{ title: "Alpha Anywhere", url: "https://alpha.school/anywhere" }],
        },
        "https://alpha.school/anywhere": {
          title: "Alpha Anywhere",
          visibleText: "Alpha Anywhere is a virtual school program.",
          links: [],
        },
      }),
    });

    const report = await refreshBioLinkInventory(input, {
      store,
      now: new Date("2026-05-27T15:00:00.000Z"),
      fetchPage: fetcher({
        "https://linktr.ee/futureof_education": {
          title: "Future of Education",
          visibleText: "No current links",
          links: [],
        },
      }),
    });

    expect(report.destinations.removed).toBe(1);
    const [destination] = await store.listDestinations("account-1");
    expect(destination.status).toBe("removed");
  });
});
