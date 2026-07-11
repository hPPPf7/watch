import { eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  tmdbCache,
  watchHistory,
  watchHistoryShares,
  watchlistItems,
  watchlistTvStates,
} from "@/server/db/schema";
import { readLatestWatchUpdate } from "@/server/realtime/watchUpdates";
import {
  isRedisRealtimeEnabled,
  readRedisJson,
  writeRedisJson,
} from "@/server/realtime/redis";

type RevisionRow = {
  state_revision: string | null;
};

type CachedStateRevision = {
  stateRevision: string;
  at: number;
};

export const STATE_REVISION_TTL_MS = 15_000;

export function stateRevisionCacheKey(
  userId: string,
  mediaType: "movie" | "tv",
  isAnime: boolean,
) {
  return `watch:revision-state:${userId}:${mediaType}:${isAnime ? 1 : 0}`;
}

function isCachedStateRevision(value: unknown): value is CachedStateRevision {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.stateRevision === "string" && typeof obj.at === "number";
}

async function readCachedStateRevision(
  userId: string,
  mediaType: "movie" | "tv",
  isAnime: boolean,
  latestWatchUpdate: { at: number } | null,
) {
  // 有 Redis 時，這種 15 秒 TTL 的簽章快取直接存 Redis，
  // 不再借用 Neon 的 tmdbCache 表；讀失敗一律視為 cache miss。
  if (isRedisRealtimeEnabled()) {
    const cached = await readRedisJson<CachedStateRevision>(
      stateRevisionCacheKey(userId, mediaType, isAnime),
    );
    if (
      cached &&
      isCachedStateRevision(cached) &&
      (!latestWatchUpdate || cached.at >= latestWatchUpdate.at)
    ) {
      return cached.stateRevision;
    }
    return null;
  }

  const db = getDb();
  const cachedStateRows = await db
    .select({
      payload: tmdbCache.payload,
      expiresAt: tmdbCache.expiresAt,
    })
    .from(tmdbCache)
    .where(eq(tmdbCache.key, stateRevisionCacheKey(userId, mediaType, isAnime)))
    .limit(1);
  const cachedStateRow = cachedStateRows[0];
  if (
    cachedStateRow &&
    new Date(cachedStateRow.expiresAt).getTime() > Date.now() &&
    isCachedStateRevision(cachedStateRow.payload) &&
    (!latestWatchUpdate || cachedStateRow.payload.at >= latestWatchUpdate.at)
  ) {
    return cachedStateRow.payload.stateRevision;
  }
  return null;
}

async function computeStateRevision(
  userId: string,
  mediaType: "movie" | "tv",
  isAnime: boolean,
) {
  const db = getDb();
  const animeFlag = mediaType === "tv" && isAnime ? 1 : 0;
  return (
    ((await db.execute(sql`
      WITH section_items AS (
        SELECT
          ${watchlistItems.id} AS id,
          ${watchlistItems.tmdbId} AS tmdb_id,
          ${watchlistItems.createdAt} AS created_at
        FROM ${watchlistItems}
        WHERE ${watchlistItems.userId} = ${userId}
          AND ${watchlistItems.mediaType} = ${mediaType}
          AND ${watchlistItems.isAnime} = ${animeFlag}
      ),
      item_state AS (
        SELECT COALESCE(
          MD5(
            STRING_AGG(
              CONCAT_WS(
                '|',
                section_items.id::text,
                section_items.tmdb_id::text,
                TO_CHAR(section_items.created_at, 'YYYYMMDDHH24MISS.US')
              ),
              ','
              ORDER BY section_items.tmdb_id, section_items.created_at, section_items.id
            )
          ),
          '0'
        ) AS sig
        FROM section_items
      ),
      own_history_state AS (
        SELECT COALESCE(
          MD5(
            STRING_AGG(
              CONCAT_WS(
                '|',
                ${watchHistory.id}::text,
                ${watchHistory.tmdbId}::text,
                COALESCE(${watchHistory.seasonNumber}, 0)::text,
                COALESCE(${watchHistory.episodeNumber}, 0)::text,
                TO_CHAR(${watchHistory.watchedAt}, 'YYYYMMDDHH24MISS.US')
              ),
              ','
              ORDER BY
                ${watchHistory.tmdbId},
                ${watchHistory.seasonNumber},
                ${watchHistory.episodeNumber},
                ${watchHistory.watchedAt},
                ${watchHistory.id}
            )
          ),
          '0'
        ) AS sig
        FROM ${watchHistory}
        WHERE ${watchHistory.userId} = ${userId}
          AND ${watchHistory.mediaType} = ${mediaType}
          AND ${watchHistory.tmdbId} IN (SELECT section_items.tmdb_id FROM section_items)
      ),
      shared_history_state AS (
        SELECT COALESCE(
          MD5(
            STRING_AGG(
              CONCAT_WS(
                '|',
                ${watchHistory.id}::text,
                ${watchHistory.tmdbId}::text,
                COALESCE(${watchHistory.seasonNumber}, 0)::text,
                COALESCE(${watchHistory.episodeNumber}, 0)::text,
                TO_CHAR(${watchHistory.watchedAt}, 'YYYYMMDDHH24MISS.US'),
                ${watchHistoryShares.targetUserId}::text
              ),
              ','
              ORDER BY
                ${watchHistory.tmdbId},
                ${watchHistory.seasonNumber},
                ${watchHistory.episodeNumber},
                ${watchHistory.watchedAt},
                ${watchHistory.id},
                ${watchHistoryShares.targetUserId}
            )
          ),
          '0'
        ) AS sig
        FROM ${watchHistoryShares}
        INNER JOIN ${watchHistory}
          ON ${watchHistory.id} = ${watchHistoryShares.watchHistoryId}
        AND ${watchHistoryShares.targetUserId} = ${userId}
          AND ${watchHistory.mediaType} = ${mediaType}
          AND ${watchHistory.tmdbId} IN (SELECT section_items.tmdb_id FROM section_items)
      ),
      tv_state_state AS (
        WITH ranked_tv_states AS (
          SELECT
            ${watchlistTvStates.tmdbId} AS tmdb_id,
            ${watchlistTvStates.lastProgress} AS last_progress,
            ${watchlistTvStates.lastTotalAired} AS last_total_aired,
            ${watchlistTvStates.lastWatchedCount} AS last_watched_count,
            ${watchlistTvStates.alertActive} AS alert_active,
            ${watchlistTvStates.alertNotifiedWatchCount} AS alert_notified_watch_count,
            ${watchlistTvStates.alertStartedAt} AS alert_started_at,
            ${watchlistTvStates.alertGeneration} AS alert_generation,
            ${watchlistTvStates.alertAcknowledgedGeneration} AS alert_acknowledged_generation,
            ${watchlistTvStates.firstReleaseAlertState} AS first_release_alert_state,
            ${watchlistTvStates.nextEpisodeSeason} AS next_episode_season,
            ${watchlistTvStates.nextEpisodeNumber} AS next_episode_number,
            ${watchlistTvStates.nextEpisodeName} AS next_episode_name,
            ${watchlistTvStates.nextEpisodeAirDate} AS next_episode_air_date,
            ${watchlistTvStates.lastWatchedSeason} AS last_watched_season,
            ${watchlistTvStates.lastWatchedEpisode} AS last_watched_episode,
            ROW_NUMBER() OVER (
              PARTITION BY ${watchlistTvStates.tmdbId}
              ORDER BY ${watchlistTvStates.updatedAt} DESC, ${watchlistTvStates.id} DESC
            ) AS row_rank
          FROM ${watchlistTvStates}
          WHERE ${watchlistTvStates.userId} = ${userId}
            AND ${watchlistTvStates.tmdbId} IN (SELECT section_items.tmdb_id FROM section_items)
        )
        SELECT COALESCE(
          MD5(
            STRING_AGG(
              CONCAT_WS(
                '|',
                ranked_tv_states.tmdb_id::text,
                COALESCE(ranked_tv_states.last_progress, 'unwatched'),
                COALESCE(ranked_tv_states.last_total_aired, 0)::text,
                COALESCE(ranked_tv_states.last_watched_count, 0)::text,
                COALESCE(ranked_tv_states.alert_active, false)::text,
                COALESCE(ranked_tv_states.alert_notified_watch_count, 0)::text,
                COALESCE(ranked_tv_states.alert_started_at::text, ''),
                COALESCE(ranked_tv_states.alert_generation, ''),
                COALESCE(ranked_tv_states.alert_acknowledged_generation, ''),
                COALESCE(ranked_tv_states.first_release_alert_state, ''),
                COALESCE(ranked_tv_states.next_episode_season, 0)::text,
                COALESCE(ranked_tv_states.next_episode_number, 0)::text,
                COALESCE(ranked_tv_states.next_episode_name, ''),
                COALESCE(ranked_tv_states.next_episode_air_date, ''),
                COALESCE(ranked_tv_states.last_watched_season, 0)::text,
                COALESCE(ranked_tv_states.last_watched_episode, 0)::text
              ),
              ','
              ORDER BY ranked_tv_states.tmdb_id
            )
          ),
          '0'
        ) AS sig
        FROM ranked_tv_states
        WHERE ${mediaType} = 'tv'
          AND ranked_tv_states.row_rank = 1
      )
      SELECT CONCAT_WS(
        ':',
        (SELECT sig FROM item_state),
        (SELECT sig FROM own_history_state),
        (SELECT sig FROM shared_history_state),
        (SELECT sig FROM tv_state_state)
      ) AS state_revision;
    `)) as unknown as { rows?: RevisionRow[] }).rows?.[0]?.state_revision ?? "0"
  );
}

async function writeCachedStateRevision(
  userId: string,
  mediaType: "movie" | "tv",
  isAnime: boolean,
  stateRevision: string,
  snapshotTakenAt: number,
) {
  if (isRedisRealtimeEnabled()) {
    await writeRedisJson(
      stateRevisionCacheKey(userId, mediaType, isAnime),
      {
        stateRevision,
        at: snapshotTakenAt,
      } satisfies CachedStateRevision,
      STATE_REVISION_TTL_MS,
    );
    return;
  }

  const db = getDb();
  const now = new Date();
  await db
    .insert(tmdbCache)
    .values({
      key: stateRevisionCacheKey(userId, mediaType, isAnime),
      payload: {
        stateRevision,
        at: snapshotTakenAt,
      },
      expiresAt: new Date(now.getTime() + STATE_REVISION_TTL_MS),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: tmdbCache.key,
      set: {
        payload: {
          stateRevision,
          at: snapshotTakenAt,
        },
        expiresAt: new Date(now.getTime() + STATE_REVISION_TTL_MS),
        updatedAt: now,
      },
    });
}

export async function getWatchlistRevision(
  userId: string,
  mediaType: "movie" | "tv",
  isAnime: boolean,
) {
  const latestWatchUpdate = await readLatestWatchUpdate(userId).catch(() => null);

  // 回傳值一律直接就是資料狀態簽章本身（快取或現算，值都一樣），不再混用
  // 「上次有沒有變更事件」的 nonce 當作另一半格式——那個 nonce 跟這裡的簽章
  // 是兩種不可能相等的格式，只要切換來源就會被誤判成「資料變了」。
  const cachedStateRevision = await readCachedStateRevision(
    userId,
    mediaType,
    isAnime,
    latestWatchUpdate,
  );
  if (cachedStateRevision) {
    return cachedStateRevision;
  }

  const stateRevision = await computeStateRevision(userId, mediaType, isAnime);
  await writeCachedStateRevision(
    userId,
    mediaType,
    isAnime,
    stateRevision,
    Date.now(),
  ).catch((error) => {
    console.warn("[watchlist/revision] state cache write failed", {
      userId,
      mediaType,
      isAnime,
      error,
    });
  });
  return stateRevision;
}

export async function getWatchlistRevisionConflict(
  userId: string,
  mediaType: "movie" | "tv",
  isAnime: boolean,
  baseRevision: unknown,
  force: unknown,
) {
  if (force === true || typeof baseRevision !== "string" || baseRevision === "") {
    return null;
  }
  const currentRevision = await getWatchlistRevision(userId, mediaType, isAnime);
  if (currentRevision === baseRevision) return null;
  return {
    code: "WATCHLIST_REVISION_CONFLICT",
    message: "Watchlist data changed on another device",
    currentRevision,
    baseRevision,
  };
}
