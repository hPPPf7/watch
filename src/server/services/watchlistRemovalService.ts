import { and, eq, inArray } from "drizzle-orm";
import { runInTransaction } from "@/server/db/client";
import { watchlistItems, watchlistTvStates } from "@/server/db/schema";
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

  await runInTransaction(async (tx) => {
    await acquireWatchlistItemLock(tx, userId, tmdbId);
    await tx
      .delete(watchlistItems)
      .where(
        and(
          eq(watchlistItems.userId, userId),
          inArray(watchlistItems.id, itemIds),
        ),
      );

    if (mediaType !== "tv") return;
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
    if (remainingItems.length > 0) return;

    await tx
      .delete(watchlistTvStates)
      .where(
        and(
          eq(watchlistTvStates.userId, userId),
          eq(watchlistTvStates.tmdbId, tmdbId),
        ),
      );
  });

  return true;
}
