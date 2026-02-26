import { NextResponse } from "next/server";
import { and, eq, gte, inArray, lt, or } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchHistory, watchHistoryShares, watchlistItems } from "@/server/db/schema";

type Body = {
  year?: number;
  month?: number;
  selectedFriendId?: string;
};

type HistoryRow = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  season_number: number | null;
  episode_number: number | null;
  watched_at: string;
};

const isHistoryMediaType = (value: string): value is "movie" | "tv" =>
  value === "movie" || value === "tv";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Not signed in" },
      { status: 401 }
    );
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const year = body?.year;
  const month = body?.month;
  const selectedFriendId = body?.selectedFriendId ?? "all";

  if (
    typeof year !== "number" ||
    typeof month !== "number" ||
    month < 0 ||
    month > 11
  ) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
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

  const start = new Date(Date.UTC(year, month, 1));
  const endExclusive = new Date(Date.UTC(year, month + 1, 1));
  const viewerId = session.user.id;

  const ownRows = await db
    .select({
      tmdb_id: watchHistory.tmdbId,
      media_type: watchHistory.mediaType,
      season_number: watchHistory.seasonNumber,
      episode_number: watchHistory.episodeNumber,
      watched_at: watchHistory.watchedAt,
    })
    .from(watchHistory)
    .where(
      and(
        eq(watchHistory.userId, viewerId),
        eq(watchHistory.projectId, "watch"),
        gte(watchHistory.watchedAt, start),
        lt(watchHistory.watchedAt, endExclusive)
      )
    );

  let sharedRows: Array<{
    tmdb_id: number;
    media_type: string;
    season_number: number | null;
    episode_number: number | null;
    watched_at: Date;
  }> = [];

  if (selectedFriendId !== "self") {
    const sharedWhereBase = and(
      eq(watchHistoryShares.projectId, "watch"),
      eq(watchHistory.projectId, "watch"),
      gte(watchHistory.watchedAt, start),
      lt(watchHistory.watchedAt, endExclusive)
    );

    const pairScope =
      selectedFriendId === "all"
        ? or(
            eq(watchHistoryShares.ownerId, viewerId),
            eq(watchHistoryShares.targetUserId, viewerId)
          )
        : or(
            and(
              eq(watchHistoryShares.ownerId, viewerId),
              eq(watchHistoryShares.targetUserId, selectedFriendId)
            ),
            and(
              eq(watchHistoryShares.ownerId, selectedFriendId),
              eq(watchHistoryShares.targetUserId, viewerId)
            )
          );

    if (pairScope) {
      sharedRows = await db
        .select({
          tmdb_id: watchHistory.tmdbId,
          media_type: watchHistory.mediaType,
          season_number: watchHistory.seasonNumber,
          episode_number: watchHistory.episodeNumber,
          watched_at: watchHistory.watchedAt,
        })
        .from(watchHistoryShares)
        .innerJoin(
          watchHistory,
          eq(watchHistoryShares.watchHistoryId, watchHistory.id)
        )
        .where(and(sharedWhereBase, pairScope));
    }
  }

  const sourceRows = [
    ...(selectedFriendId === "self"
      ? ownRows
      : selectedFriendId === "all"
        ? [...ownRows, ...sharedRows]
        : sharedRows),
  ];

  const mergedRows: HistoryRow[] = sourceRows
    .map((row) => ({
      media_type: isHistoryMediaType(row.media_type) ? row.media_type : null,
      tmdb_id: row.tmdb_id,
      season_number: row.season_number,
      episode_number: row.episode_number,
      watched_at:
        row.watched_at instanceof Date
          ? row.watched_at.toISOString()
          : new Date(row.watched_at).toISOString(),
    }))
    .filter((row): row is HistoryRow => row.media_type !== null)
    .sort((a, b) => a.watched_at.localeCompare(b.watched_at));

  const movieIds = Array.from(
    new Set(
      mergedRows.filter((row) => row.media_type === "movie").map((row) => row.tmdb_id)
    )
  );
  const tvIds = Array.from(
    new Set(
      mergedRows.filter((row) => row.media_type === "tv").map((row) => row.tmdb_id)
    )
  );

  const movieItemsRaw =
    movieIds.length === 0
      ? []
      : await db
          .select({
            tmdb_id: watchlistItems.tmdbId,
            media_type: watchlistItems.mediaType,
            is_anime: watchlistItems.isAnime,
          })
          .from(watchlistItems)
          .where(
            and(
              eq(watchlistItems.userId, viewerId),
              eq(watchlistItems.projectId, "watch"),
              eq(watchlistItems.mediaType, "movie"),
              inArray(watchlistItems.tmdbId, movieIds)
            )
          );

  const tvItemsRaw =
    tvIds.length === 0
      ? []
      : await db
          .select({
            tmdb_id: watchlistItems.tmdbId,
            media_type: watchlistItems.mediaType,
            is_anime: watchlistItems.isAnime,
          })
          .from(watchlistItems)
          .where(
            and(
              eq(watchlistItems.userId, viewerId),
              eq(watchlistItems.projectId, "watch"),
              eq(watchlistItems.mediaType, "tv"),
              inArray(watchlistItems.tmdbId, tvIds)
            )
          );

  const movieItems = movieItemsRaw.map((item) => ({
    ...item,
    title: "",
    is_anime: Boolean(item.is_anime),
  }));
  const tvItems = tvItemsRaw.map((item) => ({
    ...item,
    title: "",
    is_anime: Boolean(item.is_anime),
  }));

  return NextResponse.json({
    rows: mergedRows,
    movie_items: movieItems,
    tv_items: tvItems,
  });
}
