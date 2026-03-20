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
  alert_active: boolean;
  alert_notified_watch_count: number;
  alert_started_at: Date | string | null;
  checked_at: Date | string | null;
  updated_at: Date | string | null;
};

type IncomingWatchlistTvState = {
  last_progress: "unwatched" | "watching" | "completed";
  last_total_aired: number;
  last_watched_count: number;
};

type ChooseKeepRowOptions = {
  preferAlertMetadata?: boolean;
};

function getAlertMetadataScore(row: {
  alertActive: boolean;
  alertNotifiedWatchCount: number;
  alertStartedAt: Date | string | null;
}) {
  return (
    (row.alertActive ? 1_000_000 : 0) +
    ((row.alertNotifiedWatchCount ?? 0) * 1_000) +
    (row.alertStartedAt ? 1 : 0)
  );
}

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
      alert_active: watchlistTvStates.alertActive,
      alert_notified_watch_count: watchlistTvStates.alertNotifiedWatchCount,
      alert_started_at: watchlistTvStates.alertStartedAt,
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
    alertActive: boolean;
    alertNotifiedWatchCount: number;
    alertStartedAt: Date | string | null;
  }>,
  incoming: IncomingWatchlistTvState,
  options?: ChooseKeepRowOptions
) {
  const matchingRows = existing.filter(
    (row) =>
      row.lastProgress === incoming.last_progress &&
      (row.lastTotalAired ?? 0) === incoming.last_total_aired &&
      (row.lastWatchedCount ?? 0) === incoming.last_watched_count
  );

  if (matchingRows.length === 0) {
    return existing[0];
  }

  if (!options?.preferAlertMetadata) {
    return matchingRows[0];
  }

  return matchingRows.reduce((bestRow, row) =>
    getAlertMetadataScore(row) > getAlertMetadataScore(bestRow) ? row : bestRow
  );
}
