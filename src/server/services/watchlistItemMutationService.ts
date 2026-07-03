import { and, eq, inArray, sql } from "drizzle-orm";
import { runInTransaction } from "@/server/db/client";
import { watchlistItems } from "@/server/db/schema";

type TransactionCallback = Parameters<typeof runInTransaction>[0];
export type WatchlistMutationTransaction = Parameters<TransactionCallback>[0];

type MutateWatchlistItemInput = {
  userId: string;
  mediaType: "movie" | "tv";
  tmdbId: number;
  isAnime: boolean;
  insertIfMissing?: boolean;
};

export async function acquireWatchlistItemLock(
  tx: WatchlistMutationTransaction,
  userId: string,
  tmdbId: number,
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`watchlist:${userId}:${tmdbId}`}))`,
  );
}

export async function mutateWatchlistItemInTransaction(
  tx: WatchlistMutationTransaction,
  {
    userId,
    mediaType,
    tmdbId,
    isAnime,
    insertIfMissing = true,
  }: MutateWatchlistItemInput,
) {
  await acquireWatchlistItemLock(tx, userId, tmdbId);

  const existing = await tx
    .select({ id: watchlistItems.id, isAnime: watchlistItems.isAnime })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, userId),
        eq(watchlistItems.mediaType, mediaType),
        eq(watchlistItems.tmdbId, tmdbId),
      ),
    );
  const nextIsAnime = mediaType === "tv" && isAnime ? 1 : 0;

  if (existing.length === 0) {
    if (!insertIfMissing) {
      return {
        existingCount: 0,
        changed: false,
        changeKind: null as "add" | "reclassify" | null,
        previousIsAnime: [] as boolean[],
        affectedIsAnime: [nextIsAnime === 1],
      };
    }

    const inserted = await tx
      .insert(watchlistItems)
      .values({
        userId,
        mediaType,
        tmdbId,
        isAnime: nextIsAnime,
      })
      .onConflictDoNothing({
        target: [
          watchlistItems.userId,
          watchlistItems.mediaType,
          watchlistItems.tmdbId,
          watchlistItems.isAnime,
        ],
      })
      .returning({ id: watchlistItems.id });

    return {
      existingCount: 0,
      changed: inserted.length > 0,
      changeKind: inserted.length > 0 ? ("add" as const) : null,
      previousIsAnime: [] as boolean[],
      affectedIsAnime: [nextIsAnime === 1],
    };
  }

  const previousIsAnime =
    mediaType === "tv"
      ? Array.from(new Set(existing.map((row) => row.isAnime === 1)))
      : [false];
  const keepRow =
    existing.find((row) => row.isAnime === nextIsAnime) ?? existing[0];
  const duplicateIds = existing
    .filter((row) => row.id !== keepRow.id)
    .map((row) => row.id);
  const needsUpdate = keepRow.isAnime !== nextIsAnime;

  if (needsUpdate) {
    await tx
      .update(watchlistItems)
      .set({ isAnime: nextIsAnime })
      .where(eq(watchlistItems.id, keepRow.id));
  }
  if (duplicateIds.length > 0) {
    await tx
      .delete(watchlistItems)
      .where(inArray(watchlistItems.id, duplicateIds));
  }

  const changed = needsUpdate || duplicateIds.length > 0;
  return {
    existingCount: existing.length,
    changed,
    changeKind: changed ? ("reclassify" as const) : null,
    previousIsAnime,
    affectedIsAnime:
      mediaType === "tv"
        ? Array.from(new Set([...previousIsAnime, isAnime]))
        : [false],
  };
}

export async function mutateWatchlistItem(input: MutateWatchlistItemInput) {
  return runInTransaction((tx) =>
    mutateWatchlistItemInTransaction(tx, input),
  );
}
