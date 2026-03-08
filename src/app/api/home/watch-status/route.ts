import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchHistory } from "@/server/db/schema";
import { selectLatestWatchlistTvStates } from "@/server/services/watchlistTvStateService";

const PROJECT_ID = "watch";

type Body = {
  movieIds?: number[];
  tvIds?: number[];
  animeIds?: number[];
};

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
  const movieIds = Array.isArray(body.movieIds) ? body.movieIds : [];
  const tvIds = Array.isArray(body.tvIds) ? body.tvIds : [];
  const animeIds = Array.isArray(body.animeIds) ? body.animeIds : [];
  const tvAll = [...tvIds, ...animeIds];

  const statusMap: Record<string, "completed" | "watching"> = {};
  const buildKey = (type: "movie" | "tv", id: number, isAnime: boolean) =>
    `${type}:${isAnime ? "anime" : "series"}:${id}`;

  if (movieIds.length > 0) {
    const movieRows = await db
      .select({ tmdbId: watchHistory.tmdbId })
      .from(watchHistory)
      .where(
        and(
          eq(watchHistory.userId, userId),
          eq(watchHistory.projectId, PROJECT_ID),
          eq(watchHistory.mediaType, "movie"),
          inArray(watchHistory.tmdbId, movieIds)
        )
      );
    movieRows.forEach((row) => {
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
      const totalAired = row.last_total_aired ?? 0;
      const watchedCount = row.last_watched_count ?? 0;
      const isStrictCompleted =
        row.last_progress === "completed" && totalAired > 0 && watchedCount >= totalAired;
      if (isStrictCompleted) {
        statusMap[buildKey("tv", row.tmdb_id, false)] = "completed";
        statusMap[buildKey("tv", row.tmdb_id, true)] = "completed";
      } else if (row.last_progress === "watching" || watchedCount > 0) {
        statusMap[buildKey("tv", row.tmdb_id, false)] = "watching";
        statusMap[buildKey("tv", row.tmdb_id, true)] = "watching";
      }
    });

    const remaining = tvAll.filter((id) => {
      const tvKey = buildKey("tv", id, false);
      const animeKey = buildKey("tv", id, true);
      return !statusMap[tvKey] && !statusMap[animeKey];
    });

    if (remaining.length > 0) {
      const rows = await db
        .select({
          tmdbId: watchHistory.tmdbId,
          seasonNumber: watchHistory.seasonNumber,
          episodeNumber: watchHistory.episodeNumber,
        })
        .from(watchHistory)
        .where(
          and(
            eq(watchHistory.userId, userId),
            eq(watchHistory.projectId, PROJECT_ID),
            eq(watchHistory.mediaType, "tv"),
            inArray(watchHistory.tmdbId, remaining)
          )
        );

      const watchedByTmdb = new Map<number, Set<string>>();
      rows.forEach((row) => {
        const season = row.seasonNumber ?? 0;
        const episode = row.episodeNumber ?? 0;
        const key = `${season}:${episode}`;
        const bucket = watchedByTmdb.get(row.tmdbId) ?? new Set<string>();
        bucket.add(key);
        watchedByTmdb.set(row.tmdbId, bucket);
      });

      watchedByTmdb.forEach((set, tmdbId) => {
        if (set.size > 0) {
          statusMap[buildKey("tv", tmdbId, false)] = "watching";
          statusMap[buildKey("tv", tmdbId, true)] = "watching";
        }
      });
    }
  }

  return NextResponse.json({ statusMap });
}
