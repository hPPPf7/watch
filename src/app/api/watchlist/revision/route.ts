import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { readWatchlistRevision } from "@/server/realtime/watchUpdates";
import {
  watchHistory,
  watchHistoryShares,
  watchlistItems,
  watchlistTvStates,
} from "@/server/db/schema";

type RevisionRow = {
  state_revision: string | null;
};

export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Not signed in" },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const mediaType = url.searchParams.get("mediaType");
  const isAnime = url.searchParams.get("isAnime") === "true";
  if (mediaType !== "movie" && mediaType !== "tv") {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid mediaType" },
      { status: 400 }
    );
  }
  const animeFlag = mediaType === "tv" && isAnime ? 1 : 0;
  let db;
  try {
    db = getDb();
  } catch {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "DATABASE_URL is required" },
      { status: 500 }
    );
  }

  try {
    const result = await db.execute(sql`
      WITH section_items AS (
        SELECT
          ${watchlistItems.id} AS id,
          ${watchlistItems.tmdbId} AS tmdb_id,
          ${watchlistItems.createdAt} AS created_at
        FROM ${watchlistItems}
        WHERE ${watchlistItems.userId} = ${userId}
          AND ${watchlistItems.projectId} = 'watch'
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
          AND ${watchHistory.projectId} = 'watch'
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
        WHERE ${watchHistoryShares.projectId} = 'watch'
          AND ${watchHistoryShares.targetUserId} = ${userId}
          AND ${watchHistory.projectId} = 'watch'
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
            ROW_NUMBER() OVER (
              PARTITION BY ${watchlistTvStates.tmdbId}
              ORDER BY ${watchlistTvStates.updatedAt} DESC, ${watchlistTvStates.id} DESC
            ) AS row_rank
          FROM ${watchlistTvStates}
          WHERE ${watchlistTvStates.userId} = ${userId}
            AND ${watchlistTvStates.projectId} = 'watch'
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
                COALESCE(ranked_tv_states.last_watched_count, 0)::text
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
    `);
    const stateRevision =
      (result as unknown as { rows?: RevisionRow[] }).rows?.[0]?.state_revision ??
      "0";
    const cachedRevision =
      (await readWatchlistRevision(userId, mediaType, animeFlag === 1)) ??
      stateRevision;
    const revision = `${cachedRevision}:${stateRevision}`;

    return NextResponse.json({ revision });
  } catch (error) {
    console.error("[watchlist/revision] failed", {
      userId,
      mediaType,
      isAnime,
      error,
    });
    return NextResponse.json(
      { code: "REVISION_FAILED", message: "Failed to load revision" },
      { status: 500 }
    );
  }
}
