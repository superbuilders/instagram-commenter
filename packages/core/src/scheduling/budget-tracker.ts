import { eq, and, sql } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { dailyBudgets } from "../db/schema.js";
import { getLocalDateString } from "../time.js";

export function calculateDailyBudget(commentVolume: number): number {
  if (commentVolume < 50) return 5;
  if (commentVolume < 100) return 8;
  if (commentVolume < 150) return 15;
  if (commentVolume < 250) return 25;
  return 40;
}

export async function getOrCreateDailyBudget(
  accountId: string,
  db: Database,
  commentVolume = 150
) {
  const today = getLocalDateString();

  const existing = await db
    .select()
    .from(dailyBudgets)
    .where(
      and(
        eq(dailyBudgets.accountId, accountId),
        eq(dailyBudgets.budgetDate, today)
      )
    );

  if (existing.length > 0) return existing[0];

  const budget = calculateDailyBudget(commentVolume);
  const [row] = await db
    .insert(dailyBudgets)
    .values({
      accountId,
      budgetDate: today,
      budgetLimit: budget,
    })
    .onConflictDoNothing()
    .returning();

  if (row) return row;

  const [refetched] = await db
    .select()
    .from(dailyBudgets)
    .where(
      and(
        eq(dailyBudgets.accountId, accountId),
        eq(dailyBudgets.budgetDate, today)
      )
    );
  return refetched;
}

export async function getRemainingBudget(
  accountId: string,
  db: Database
): Promise<number> {
  const budget = await getOrCreateDailyBudget(accountId, db);
  return Math.max(0, budget.budgetLimit - budget.repliesAllocated);
}

export async function incrementAllocated(
  accountId: string,
  group: "narrative_shaping" | "community_building" | "informational",
  db: Database
): Promise<void> {
  const today = getLocalDateString();

  const groupColumn =
    group === "narrative_shaping"
      ? dailyBudgets.narrativeReplies
      : group === "community_building"
        ? dailyBudgets.communityReplies
        : dailyBudgets.informationalReplies;

  await db
    .update(dailyBudgets)
    .set({
      repliesAllocated: sql`${dailyBudgets.repliesAllocated} + 1`,
      repliesPending: sql`${dailyBudgets.repliesPending} + 1`,
      [groupColumn.name]: sql`${groupColumn} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(dailyBudgets.accountId, accountId),
        eq(dailyBudgets.budgetDate, today)
      )
    );
}

export async function incrementPosted(
  accountId: string,
  db: Database
): Promise<void> {
  const today = getLocalDateString();

  await db
    .update(dailyBudgets)
    .set({
      repliesPosted: sql`${dailyBudgets.repliesPosted} + 1`,
      repliesPending: sql`${dailyBudgets.repliesPending} - 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(dailyBudgets.accountId, accountId),
        eq(dailyBudgets.budgetDate, today)
      )
    );
}

export async function decrementPending(
  accountId: string,
  db: Database
): Promise<void> {
  const today = getLocalDateString();

  await db
    .update(dailyBudgets)
    .set({
      repliesPending: sql`GREATEST(${dailyBudgets.repliesPending} - 1, 0)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(dailyBudgets.accountId, accountId),
        eq(dailyBudgets.budgetDate, today)
      )
    );
}
