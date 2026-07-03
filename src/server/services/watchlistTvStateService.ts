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
  alert_generation: string | null;
  alert_acknowledged_generation: string | null;
  first_release_alert_state: string | null;
  next_episode_season: number | null;
  next_episode_number: number | null;
  next_episode_name: string | null;
  next_episode_air_date: string | null;
  last_watched_season: number | null;
  last_watched_episode: number | null;
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
  alertGeneration?: string | null;
  alertAcknowledgedGeneration?: string | null;
  firstReleaseAlertState?: string | null;
}) {
  return (
    (row.alertAcknowledgedGeneration ? 2_000_000 : 0) +
    (row.alertActive ? 1_000_000 : 0) +
    ((row.alertNotifiedWatchCount ?? 0) * 1_000) +
    (row.alertStartedAt ? 1 : 0) +
    (row.firstReleaseAlertState ? 1 : 0)
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
      alert_generation: watchlistTvStates.alertGeneration,
      alert_acknowledged_generation:
        watchlistTvStates.alertAcknowledgedGeneration,
      first_release_alert_state: watchlistTvStates.firstReleaseAlertState,
      next_episode_season: watchlistTvStates.nextEpisodeSeason,
      next_episode_number: watchlistTvStates.nextEpisodeNumber,
      next_episode_name: watchlistTvStates.nextEpisodeName,
      next_episode_air_date: watchlistTvStates.nextEpisodeAirDate,
      last_watched_season: watchlistTvStates.lastWatchedSeason,
      last_watched_episode: watchlistTvStates.lastWatchedEpisode,
      checked_at: watchlistTvStates.checkedAt,
      updated_at: watchlistTvStates.updatedAt,
    })
    .from(watchlistTvStates)
    .where(
      and(
        eq(watchlistTvStates.userId, userId),
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
    alertGeneration?: string | null;
    alertAcknowledgedGeneration?: string | null;
    firstReleaseAlertState?: string | null;
    tmdbMetadataFetchedAt?: Date | string | null;
    nextEpisodeSeason?: number | null;
    nextEpisodeNumber?: number | null;
    nextEpisodeName?: string | null;
    nextEpisodeAirDate?: string | null;
    lastWatchedSeason?: number | null;
    lastWatchedEpisode?: number | null;
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
