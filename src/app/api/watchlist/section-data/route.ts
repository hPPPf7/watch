import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import {
  friends,
  watchHistory,
  watchHistoryShares,
  watchlistItems,
} from "@/server/db/schema";
import { selectLatestWatchlistTvStates } from "@/server/services/watchlistTvStateService";
import { getWatchlistRevision } from "@/server/services/watchlistRevisionService";
import { getWatchlistCardMetadataBatch } from "@/server/tmdb/watchlistCardMetadata";

type EpisodeRow = {
  id: string;
  tmdbId: number;
  seasonNumber: number | null;
  episodeNumber: number | null;
  watchedAt: Date | string;
  createdAt: Date | string | null;
};

const episodeRank = (season: number | null, episode: number | null) =>
  (season ?? 0) * 100000 + (episode ?? 0);

const toIsoString = (value: Date | string | null | undefined) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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
  const includeRevision = url.searchParams.get("refresh") === "1";
  if (mediaType !== "movie" && mediaType !== "tv") {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid mediaType" },
      { status: 400 }
    );
  }

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
    const revision = includeRevision
      ? await getWatchlistRevision(userId, mediaType, isAnime)
      : null;
    const withRevision = <T extends Record<string, unknown>>(payload: T) =>
      revision === null ? payload : { ...payload, revision };
    const itemRows = await db
      .select({
        id: watchlistItems.id,
        tmdb_id: watchlistItems.tmdbId,
        media_type: watchlistItems.mediaType,
        is_anime: watchlistItems.isAnime,
        created_at: watchlistItems.createdAt,
      })
      .from(watchlistItems)
      .where(
        and(
          eq(watchlistItems.userId, userId),
          eq(watchlistItems.mediaType, mediaType),
          mediaType === "tv"
            ? eq(watchlistItems.isAnime, isAnime ? 1 : 0)
            : eq(watchlistItems.isAnime, 0)
        )
      )
      .orderBy(desc(watchlistItems.createdAt));

    const metadataMap = await getWatchlistCardMetadataBatch(
      itemRows.map((row) => ({
        type: row.media_type as "movie" | "tv",
        tmdbId: row.tmdb_id,
      })),
    );

    const rows = itemRows.map((row) => {
      const metadata = metadataMap.get(`${row.media_type}:${row.tmdb_id}`) ?? null;
      return {
        id: row.id,
        tmdb_id: row.tmdb_id,
        title: metadata?.title ?? `TMDB ${row.tmdb_id}`,
        year: metadata?.year ?? null,
        release_date: metadata?.releaseDate ?? null,
        ...(row.media_type === "tv"
          ? { status: metadata?.status ?? null }
          : {}),
        tmdb_cached_at: metadata?.cachedAt ?? null,
        tmdb_stale: metadata?.isStale ?? true,
        poster_path: metadata?.posterPath ?? null,
        media_type: row.media_type,
        is_anime: metadata?.isAnime ?? Boolean(row.is_anime),
        created_at:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : String(row.created_at),
      };
    });

    const tmdbIds = rows.map((row) => row.tmdb_id);
    if (mediaType === "movie") {
      if (tmdbIds.length === 0) {
        return NextResponse.json(withRevision({ rows, movieHistoryRows: [] }));
      }
      try {
        const ownRecords = await db
          .select({
            id: watchHistory.id,
            tmdb_id: watchHistory.tmdbId,
            watched_at: watchHistory.watchedAt,
            created_at: watchHistory.createdAt,
            owner_id: watchHistory.userId,
          })
          .from(watchHistory)
          .where(
            and(
              eq(watchHistory.userId, userId),
              eq(watchHistory.mediaType, "movie"),
              inArray(watchHistory.tmdbId, tmdbIds)
            )
          )
          .orderBy(desc(watchHistory.watchedAt), desc(watchHistory.createdAt), desc(watchHistory.id));

        const sharedRecords = await db
          .select({
            id: watchHistory.id,
            tmdb_id: watchHistory.tmdbId,
            watched_at: watchHistory.watchedAt,
            created_at: watchHistory.createdAt,
            owner_id: watchHistory.userId,
          })
          .from(watchHistoryShares)
          .innerJoin(
            watchHistory,
            eq(watchHistory.id, watchHistoryShares.watchHistoryId)
          )
          .where(
            and(
              eq(watchHistoryShares.targetUserId, userId),
              eq(watchHistory.mediaType, "movie"),
              inArray(watchHistory.tmdbId, tmdbIds)
            )
          )
          .orderBy(desc(watchHistory.watchedAt), desc(watchHistory.createdAt), desc(watchHistory.id));

        const recordMap = new Map<
          string,
          {
            id: string;
            tmdb_id: number;
            watched_at: Date | string;
            created_at: Date | string | null;
            owner_id: string;
          }
        >();
        [...ownRecords, ...sharedRecords].forEach((row) => recordMap.set(row.id, row));

        const records = Array.from(recordMap.values());
        const countMap: Record<number, number> = {};
        const latestRecordByTmdb = new Map<
          number,
          {
            id: string;
            owner_id: string;
            watched_at: string;
            watchedAtTs: number;
            createdAtTs: number;
          }
        >();
        records.forEach((row) => {
          const tmdbId = row.tmdb_id;
          countMap[tmdbId] = (countMap[tmdbId] ?? 0) + 1;
          const watchedAtDate =
            row.watched_at instanceof Date ? row.watched_at : new Date(row.watched_at);
          const watchedAtTs = watchedAtDate.getTime();
          const createdAtDate =
            row.created_at instanceof Date
              ? row.created_at
              : row.created_at
                ? new Date(row.created_at)
                : null;
          const createdAtTs = createdAtDate?.getTime() ?? 0;
          const watchedAt = watchedAtDate.toISOString().slice(0, 10);
          const current = latestRecordByTmdb.get(tmdbId);
          const shouldReplace =
            !current ||
            watchedAtTs > current.watchedAtTs ||
            (watchedAtTs === current.watchedAtTs &&
              (createdAtTs > current.createdAtTs ||
                (createdAtTs === current.createdAtTs && row.id > current.id)));
          if (shouldReplace) {
            latestRecordByTmdb.set(tmdbId, {
              id: row.id,
              owner_id: row.owner_id,
              watched_at: watchedAt,
              watchedAtTs,
              createdAtTs,
            });
          }
        });

        const latestRecordIds = Array.from(
          new Set(Array.from(latestRecordByTmdb.values()).map((row) => row.id))
        );
        const shareRows =
          latestRecordIds.length === 0
            ? []
            : await db
                .select({
                  watchHistoryId: watchHistoryShares.watchHistoryId,
                  friendId: watchHistoryShares.targetUserId,
                })
                .from(watchHistoryShares)
                .where(
                  and(
                    inArray(watchHistoryShares.watchHistoryId, latestRecordIds)
                  )
                );

        const sharesByRecord = new Map<string, Array<{ id: string }>>();
        shareRows.forEach((row) => {
          const list = sharesByRecord.get(row.watchHistoryId) ?? [];
          list.push({ id: row.friendId });
          sharesByRecord.set(row.watchHistoryId, list);
        });

        const participantIds = Array.from(
          new Set([
            userId,
            ...Array.from(latestRecordByTmdb.values()).map((row) => row.owner_id),
            ...shareRows.map((row) => row.friendId),
          ])
        );
        const friendRows =
          participantIds.length === 0
            ? []
            : await db
                .select({
                  friendId: friends.friendId,
                  friendNickname: friends.friendNickname,
                })
                .from(friends)
                .where(
                  and(
                    eq(friends.userId, userId),
                    inArray(friends.friendId, participantIds)
                  )
                );

        const visibleNicknameById = new Map<string, string | null>();
        friendRows.forEach((row) =>
          visibleNicknameById.set(row.friendId, row.friendNickname ?? null)
        );
        const visibleParticipantIds = new Set<string>([
          userId,
          ...friendRows.map((row) => row.friendId),
        ]);

        const movieHistoryRows = tmdbIds.flatMap((tmdbId) => {
          const latest = latestRecordByTmdb.get(tmdbId);
          if (!latest) return [];
          const participants = [
            ...(visibleParticipantIds.has(latest.owner_id)
              ? [
                  {
                    id: latest.owner_id,
                    nickname:
                      latest.owner_id === userId
                        ? null
                        : (visibleNicknameById.get(latest.owner_id) ?? null),
                    isOwner: true,
                  },
                ]
              : []),
            ...(sharesByRecord.get(latest.id) ?? [])
              .filter(
                (share) =>
                  share.id !== latest.owner_id &&
                  visibleParticipantIds.has(share.id)
              )
              .map((share) => ({
                id: share.id,
                nickname:
                  share.id === userId
                    ? null
                    : (visibleNicknameById.get(share.id) ?? null),
                isOwner: false,
              })),
          ];
          return participants.map((participant) => ({
            tmdb_id: tmdbId,
            watched_at: latest.watched_at,
            created_at:
              latest.createdAtTs > 0
                ? new Date(latest.createdAtTs).toISOString()
                : null,
            owner_id: latest.owner_id,
            watch_count: countMap[tmdbId] ?? 0,
            friend_id: participant.id,
            friend_nickname: participant.nickname,
            is_owner: participant.isOwner,
          }));
        });

        return NextResponse.json(withRevision({ rows, movieHistoryRows }));
      } catch (error) {
        console.warn("[watchlist/section-data] movie supplemental query failed", {
          userId,
          mediaType,
          error,
        });
        return NextResponse.json(withRevision({ rows, movieHistoryRows: [] }));
      }
    }

    if (tmdbIds.length === 0) {
      return NextResponse.json(withRevision({
        rows,
        latestEpisodes: {},
        watchedCounts: {},
        latestWatchedDates: {},
        latestWatchedCreatedAts: {},
        tvStateRows: [],
      }));
    }

    let historyPayload: {
      latestEpisodes: Record<number, { season: number; episode: number }>;
      watchedCounts: Record<number, number>;
      latestWatchedDates: Record<number, string>;
      latestWatchedCreatedAts: Record<number, string>;
    } = {
      latestEpisodes: {},
      watchedCounts: {},
      latestWatchedDates: {},
      latestWatchedCreatedAts: {},
    };
    try {
      historyPayload = await (async () => {
          const ownRows = (await db
            .select({
              id: watchHistory.id,
              tmdbId: watchHistory.tmdbId,
              seasonNumber: watchHistory.seasonNumber,
              episodeNumber: watchHistory.episodeNumber,
              watchedAt: watchHistory.watchedAt,
              createdAt: watchHistory.createdAt,
            })
            .from(watchHistory)
            .where(
              and(
                eq(watchHistory.userId, userId),
                eq(watchHistory.mediaType, "tv"),
                inArray(watchHistory.tmdbId, tmdbIds)
              )
            )) as EpisodeRow[];

          const sharedRows = (await db
            .select({
              id: watchHistory.id,
              tmdbId: watchHistory.tmdbId,
              seasonNumber: watchHistory.seasonNumber,
              episodeNumber: watchHistory.episodeNumber,
              watchedAt: watchHistory.watchedAt,
              createdAt: watchHistory.createdAt,
            })
            .from(watchHistoryShares)
            .innerJoin(
              watchHistory,
              eq(watchHistory.id, watchHistoryShares.watchHistoryId)
            )
            .where(
              and(
                eq(watchHistoryShares.targetUserId, userId),
                eq(watchHistory.mediaType, "tv"),
                inArray(watchHistory.tmdbId, tmdbIds)
              )
            )) as EpisodeRow[];

          const rowMap = new Map<string, EpisodeRow>();
          [...ownRows, ...sharedRows].forEach((row) => rowMap.set(row.id, row));
          const historyRows = Array.from(rowMap.values());

          const latestEpisodes: Record<number, { season: number; episode: number }> = {};
          const watchedCounts: Record<number, number> = {};
          const latestWatchedDates: Record<number, string> = {};
          const latestWatchedCreatedAts: Record<number, string> = {};
          const topRank: Record<number, number> = {};
          const latestTimestamp: Record<number, number> = {};
          const latestCreatedAtTimestamp: Record<number, number> = {};

          historyRows.forEach((row) => {
            watchedCounts[row.tmdbId] = (watchedCounts[row.tmdbId] ?? 0) + 1;
            const watchedAtDate =
              row.watchedAt instanceof Date ? row.watchedAt : new Date(row.watchedAt);
            const watchedAtIso = watchedAtDate.toISOString().slice(0, 10);
            const watchedAtTs = watchedAtDate.getTime();
            const createdAtDate =
              row.createdAt instanceof Date
                ? row.createdAt
                : row.createdAt
                  ? new Date(row.createdAt)
                  : null;
            const createdAtTs = createdAtDate?.getTime() ?? 0;
            if (
              latestTimestamp[row.tmdbId] === undefined ||
              watchedAtTs > latestTimestamp[row.tmdbId] ||
              (watchedAtTs === latestTimestamp[row.tmdbId] &&
                createdAtTs > (latestCreatedAtTimestamp[row.tmdbId] ?? 0))
            ) {
              latestTimestamp[row.tmdbId] = watchedAtTs;
              latestCreatedAtTimestamp[row.tmdbId] = createdAtTs;
              latestWatchedDates[row.tmdbId] = watchedAtIso;
              latestWatchedCreatedAts[row.tmdbId] = (createdAtDate ?? watchedAtDate).toISOString();
            }
            const rank = episodeRank(row.seasonNumber, row.episodeNumber);
            if (rank <= 0) return;
            if (topRank[row.tmdbId] === undefined || rank > topRank[row.tmdbId]) {
              topRank[row.tmdbId] = rank;
              latestEpisodes[row.tmdbId] = {
                season: row.seasonNumber ?? 0,
                episode: row.episodeNumber ?? 0,
              };
            }
          });

          return { latestEpisodes, watchedCounts, latestWatchedDates, latestWatchedCreatedAts };
        })();
    } catch (error) {
      console.warn("[watchlist/section-data] tv history query failed", {
        userId,
        mediaType,
        isAnime,
        error,
      });
    }

    let tvStateRows: Array<{
      tmdb_id: number;
      last_progress: string | null;
      last_total_aired: number | null;
      last_watched_count: number | null;
      alert_active: boolean;
      alert_notified_watch_count: number;
      alert_started_at: Date | string | null;
      next_episode_season: number | null;
      next_episode_number: number | null;
      next_episode_name: string | null;
      next_episode_air_date: string | null;
      last_watched_season: number | null;
      last_watched_episode: number | null;
      checked_at: Date | string | null;
    }> = [];
    try {
      tvStateRows = await selectLatestWatchlistTvStates(db, userId, tmdbIds);
    } catch (error) {
      console.warn("[watchlist/section-data] tv state query failed", {
        userId,
        mediaType,
        isAnime,
        error,
      });
    }

    return NextResponse.json(withRevision({
      rows,
      latestEpisodes: historyPayload.latestEpisodes,
      watchedCounts: historyPayload.watchedCounts,
      latestWatchedDates: historyPayload.latestWatchedDates,
      latestWatchedCreatedAts: historyPayload.latestWatchedCreatedAts,
      tvStateRows: tvStateRows.map((row) => ({
        tmdb_id: row.tmdb_id,
        last_progress: (row.last_progress ?? "unwatched") as
          | "unwatched"
          | "watching"
          | "completed",
        last_total_aired: row.last_total_aired ?? 0,
        last_watched_count: row.last_watched_count ?? 0,
        alert_active: row.alert_active,
        alert_notified_watch_count: row.alert_notified_watch_count,
        next_episode_season: row.next_episode_season,
        next_episode_number: row.next_episode_number,
        next_episode_name: row.next_episode_name,
        next_episode_air_date: row.next_episode_air_date,
        last_watched_season: row.last_watched_season,
        last_watched_episode: row.last_watched_episode,
        last_known_status: null,
        last_checked_at: toIsoString(row.checked_at),
        alert_started_at: toIsoString(row.alert_started_at),
      })),
    }));
  } catch (error) {
    console.error("[watchlist/section-data] failed", {
      userId,
      mediaType,
      isAnime,
      error,
    });
    return NextResponse.json(
      { code: "SECTION_DATA_FAILED", message: "Failed to load section data" },
      { status: 500 }
    );
  }
}
