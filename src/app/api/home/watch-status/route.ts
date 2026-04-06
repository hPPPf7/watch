import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchHistory, watchHistoryShares } from "@/server/db/schema";
import { selectLatestWatchlistTvStates } from "@/server/services/watchlistTvStateService";

type Body = {
  movieIds?: number[];
  tvIds?: number[];
  animeIds?: number[];
};

function isPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function normalizeIdList(value: unknown) {
  if (!Array.isArray(value)) {
    return { ok: true as const, ids: [] as number[] };
  }
  if (value.some((item) => !isPositiveInteger(item))) {
    return { ok: false as const, ids: [] as number[] };
  }
  return { ok: true as const, ids: value };
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Not signed in" },
      { status: 401 }
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

  const body = (await request.json().catch(() => ({}))) as Body;
  const movieIdsResult = normalizeIdList(body.movieIds);
  const tvIdsResult = normalizeIdList(body.tvIds);
  const animeIdsResult = normalizeIdList(body.animeIds);

  if (!movieIdsResult.ok || !tvIdsResult.ok || !animeIdsResult.ok) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
    );
  }

  const movieIds = movieIdsResult.ids;
  const tvIds = tvIdsResult.ids;
  const animeIds = animeIdsResult.ids;
  const tvAll = Array.from(new Set([...tvIds, ...animeIds]));
  const tvIdSet = new Set(tvIds);
  const animeIdSet = new Set(animeIds);

  const statusMap: Record<string, "completed" | "watching"> = {};
  const buildKey = (type: "movie" | "tv", id: number, isAnime: boolean) =>
    `${type}:${isAnime ? "anime" : "series"}:${id}`;

  if (movieIds.length > 0) {
    const ownMovieRows = await db
      .select({ tmdbId: watchHistory.tmdbId })
      .from(watchHistory)
      .where(
        and(
          eq(watchHistory.userId, userId),
          eq(watchHistory.mediaType, "movie"),
          inArray(watchHistory.tmdbId, movieIds)
        )
      );
    const sharedMovieRows = await db
      .select({ tmdbId: watchHistory.tmdbId })
      .from(watchHistoryShares)
      .innerJoin(
        watchHistory,
        eq(watchHistoryShares.watchHistoryId, watchHistory.id)
      )
      .where(
        and(
          eq(watchHistoryShares.targetUserId, userId),
          eq(watchHistory.mediaType, "movie"),
          inArray(watchHistory.tmdbId, movieIds)
        )
      );

    [...ownMovieRows, ...sharedMovieRows].forEach((row) => {
      statusMap[buildKey("movie", row.tmdbId, false)] = "completed";
    });
  }

  if (tvAll.length > 0) {
    const latestStateRows = await selectLatestWatchlistTvStates(db, userId, tvAll);

    (
      latestStateRows as Array<{
        id: string;
        tmdb_id: number;
        last_progress: string;
        last_total_aired: number | null;
        last_watched_count: number | null;
        updated_at: Date | string | null;
      }>
    ).forEach((row) => {
      if (row.last_progress === "completed") {
        if (tvIdSet.has(row.tmdb_id) && !animeIdSet.has(row.tmdb_id)) {
          statusMap[buildKey("tv", row.tmdb_id, false)] = "completed";
        }
        if (animeIdSet.has(row.tmdb_id)) {
          statusMap[buildKey("tv", row.tmdb_id, true)] = "completed";
        }
      } else if (
        row.last_progress === "watching" ||
        (row.last_watched_count ?? 0) > 0
      ) {
        if (tvIdSet.has(row.tmdb_id) && !animeIdSet.has(row.tmdb_id)) {
          statusMap[buildKey("tv", row.tmdb_id, false)] = "watching";
        }
        if (animeIdSet.has(row.tmdb_id)) {
          statusMap[buildKey("tv", row.tmdb_id, true)] = "watching";
        }
      }
    });

    const remaining = tvAll.filter((id) => {
      const tvKey = buildKey("tv", id, false);
      const animeKey = buildKey("tv", id, true);
      return !statusMap[tvKey] && !statusMap[animeKey];
    });

    if (remaining.length > 0) {
      const ownRows = await db
        .select({
          tmdbId: watchHistory.tmdbId,
          seasonNumber: watchHistory.seasonNumber,
          episodeNumber: watchHistory.episodeNumber,
        })
        .from(watchHistory)
        .where(
          and(
            eq(watchHistory.userId, userId),
            eq(watchHistory.mediaType, "tv"),
            inArray(watchHistory.tmdbId, remaining)
          )
        );
      const sharedRows = await db
        .select({
          tmdbId: watchHistory.tmdbId,
          seasonNumber: watchHistory.seasonNumber,
          episodeNumber: watchHistory.episodeNumber,
        })
        .from(watchHistoryShares)
        .innerJoin(
          watchHistory,
          eq(watchHistoryShares.watchHistoryId, watchHistory.id)
        )
        .where(
          and(
            eq(watchHistoryShares.targetUserId, userId),
            eq(watchHistory.mediaType, "tv"),
            inArray(watchHistory.tmdbId, remaining)
          )
        );

      const watchedByTmdb = new Map<number, Set<string>>();
      [...ownRows, ...sharedRows].forEach((row) => {
        const season = row.seasonNumber ?? 0;
        const episode = row.episodeNumber ?? 0;
        const key = `${season}:${episode}`;
        const bucket = watchedByTmdb.get(row.tmdbId) ?? new Set<string>();
        bucket.add(key);
        watchedByTmdb.set(row.tmdbId, bucket);
      });

      watchedByTmdb.forEach((set, tmdbId) => {
        if (set.size > 0) {
          if (tvIdSet.has(tmdbId) && !animeIdSet.has(tmdbId)) {
            statusMap[buildKey("tv", tmdbId, false)] = "watching";
          }
          if (animeIdSet.has(tmdbId)) {
            statusMap[buildKey("tv", tmdbId, true)] = "watching";
          }
        }
      });
    }
  }

  return NextResponse.json({ statusMap });
}
