import { and, eq, inArray } from "drizzle-orm";
import { runInTransaction } from "@/server/db/client";
import { watchlistItems, watchlistTvStates, watchHistory, watchHistoryShares } from "@/server/db/schema";
import { acquireWatchlistItemLock } from "@/server/services/watchlistItemMutationService";

type RemoveWatchlistItemsInput = {
  userId: string;
  mediaType: "movie" | "tv";
  tmdbId: number;
  itemIds: string[];
};

export async function removeWatchlistItemsAndCleanupTvState({
  userId,
  mediaType,
  tmdbId,
  itemIds,
}: RemoveWatchlistItemsInput) {
  if (itemIds.length === 0) return false;

  return runInTransaction(async (tx) => {
    await acquireWatchlistItemLock(tx, userId, tmdbId);
    const own = await tx.select({ id: watchHistory.id }).from(watchHistory)
      .where(and(
        eq(watchHistory.userId, userId),
        eq(watchHistory.mediaType, mediaType),
        eq(watchHistory.tmdbId, tmdbId),
      )).limit(1);
    const shared = await tx.select({ id: watchHistory.id }).from(watchHistoryShares)
      .innerJoin(watchHistory, eq(watchHistory.id, watchHistoryShares.watchHistoryId))
      .where(and(
        eq(watchHistoryShares.targetUserId, userId),
        eq(watchHistory.mediaType, mediaType),
        eq(watchHistory.tmdbId, tmdbId),
      )).limit(1);
    if (own.length || shared.length) return "history_exists" as const;
    await tx
      .delete(watchlistItems)
      .where(
        and(
          eq(watchlistItems.userId, userId),
          inArray(watchlistItems.id, itemIds),
        ),
      );

    if (mediaType !== "tv") return true;
    const remainingItems = await tx
      .select({ id: watchlistItems.id })
      .from(watchlistItems)
      .where(
        and(
          eq(watchlistItems.userId, userId),
          eq(watchlistItems.mediaType, "tv"),
          eq(watchlistItems.tmdbId, tmdbId),
        ),
      )
      .limit(1);
    if (remainingItems.length > 0) return true;

    await tx
      .delete(watchlistTvStates)
      .where(
        and(
          eq(watchlistTvStates.userId, userId),
          eq(watchlistTvStates.tmdbId, tmdbId),
        ),
      );
    return true;
  });
}
