import { and, desc, eq, inArray } from "drizzle-orm";
import type { getDb } from "@/server/db/client";
import { watchlistTvStates } from "@/server/db/schema";

type DbLike = ReturnType<typeof getDb>;

export type WatchlistTvStateRow = {
  id: string;
  tmdb_id: number;
  last_progress: string | null;
  last_total_aired: number | null;
  last_watched_count: number | null;
  checked_at: Date | string | null;
  updated_at: Date | string | null;
};

type IncomingWatchlistTvState = {
  last_progress: "unwatched" | "watching" | "completed";
  last_total_aired: number;
  last_watched_count: number;
};

export function dedupeLatestWatchlistTvStates(rows: WatchlistTvStateRow[]) {
  return Array.from(
    rows.reduce((map, row) => {
      if (!map.has(row.tmdb_id)) {
        map.set(row.tmdb_id, row);
      }
      return map;
    }, new Map<number, WatchlistTvStateRow>()).values()
  );
}

export async function selectLatestWatchlistTvStates(
  db: DbLike,
  userId: string,
  tmdbIds: number[]
) {
  if (tmdbIds.length === 0) return [] as WatchlistTvStateRow[];

  const rows = await db
    .select({
      id: watchlistTvStates.id,
      tmdb_id: watchlistTvStates.tmdbId,
      last_progress: watchlistTvStates.lastProgress,
      last_total_aired: watchlistTvStates.lastTotalAired,
      last_watched_count: watchlistTvStates.lastWatchedCount,
      checked_at: watchlistTvStates.checkedAt,
      updated_at: watchlistTvStates.updatedAt,
    })
    .from(watchlistTvStates)
    .where(
      and(
        eq(watchlistTvStates.userId, userId),
        eq(watchlistTvStates.projectId, "watch"),
        inArray(watchlistTvStates.tmdbId, tmdbIds)
      )
    )
    .orderBy(desc(watchlistTvStates.updatedAt), desc(watchlistTvStates.id));

  return dedupeLatestWatchlistTvStates(rows);
}

export function chooseWatchlistTvStateKeepRow(
  existing: Array<{
    id: string;
    lastProgress: string | null;
    lastTotalAired: number | null;
    lastWatchedCount: number | null;
  }>,
  incoming: IncomingWatchlistTvState
) {
  return (
    existing.find(
      (row) =>
        row.lastProgress === incoming.last_progress &&
        (row.lastTotalAired ?? 0) === incoming.last_total_aired &&
        (row.lastWatchedCount ?? 0) === incoming.last_watched_count
    ) ?? existing[0]
  );
}
