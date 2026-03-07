import { NextResponse } from "next/server";
import { and, eq, gte, inArray, lt, notExists, or } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchHistory, watchHistoryShares, watchlistItems } from "@/server/db/schema";

type Body = {
  year?: number;
  month?: number;
  selectedFriendId?: string;
};

type HistoryRow = {
  history_id: string;
  tmdb_id: number;
  media_type: "movie" | "tv";
  season_number: number | null;
  episode_number: number | null;
  watched_at: string;
  owner_id: string;
  companion_id: string | null;
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
  const sharedWithViewerScope = or(
    eq(watchHistoryShares.ownerId, viewerId),
    eq(watchHistoryShares.targetUserId, viewerId)
  );
  const ownRowsWhere = and(
    eq(watchHistory.userId, viewerId),
    eq(watchHistory.projectId, "watch"),
    gte(watchHistory.watchedAt, start),
    lt(watchHistory.watchedAt, endExclusive)
  );
  // "自己單獨看" is defined as records without any shared-watch relation.
  // This intentionally excludes the viewer's own history rows once they have
  // been shared to friends, so the filter stays distinct from "所有人".
  const soloOwnRowsWhere = and(
    eq(watchHistory.userId, viewerId),
    eq(watchHistory.projectId, "watch"),
    gte(watchHistory.watchedAt, start),
    lt(watchHistory.watchedAt, endExclusive),
    notExists(
      db
        .select({ id: watchHistoryShares.id })
        .from(watchHistoryShares)
        .where(
          and(
            eq(watchHistoryShares.projectId, "watch"),
            eq(watchHistoryShares.watchHistoryId, watchHistory.id),
            sharedWithViewerScope
          )
        )
    )
  );
  const dedupedAllOwnRowsWhere = and(
    eq(watchHistory.userId, viewerId),
    eq(watchHistory.projectId, "watch"),
    gte(watchHistory.watchedAt, start),
    lt(watchHistory.watchedAt, endExclusive),
    notExists(
      db
        .select({ id: watchHistoryShares.id })
        .from(watchHistoryShares)
        .where(
          and(
            eq(watchHistoryShares.projectId, "watch"),
            eq(watchHistoryShares.watchHistoryId, watchHistory.id),
            sharedWithViewerScope
          )
        )
    )
  );

  const ownRows = await db
    .select({
      history_id: watchHistory.id,
      tmdb_id: watchHistory.tmdbId,
      media_type: watchHistory.mediaType,
      season_number: watchHistory.seasonNumber,
      episode_number: watchHistory.episodeNumber,
      watched_at: watchHistory.watchedAt,
      owner_id: watchHistory.userId,
      companion_id: watchHistory.userId,
    })
    .from(watchHistory)
    .where(
      selectedFriendId === "self"
        ? soloOwnRowsWhere
        : selectedFriendId === "all"
          ? dedupedAllOwnRowsWhere
          : ownRowsWhere
    );

  let sharedRows: Array<{
    history_id: string;
    tmdb_id: number;
    media_type: string;
    season_number: number | null;
    episode_number: number | null;
    watched_at: Date;
    owner_id: string;
    target_user_id: string;
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
      const matchedHistoryIdsRows = await db
        .select({ history_id: watchHistory.id })
        .from(watchHistoryShares)
        .innerJoin(
          watchHistory,
          eq(watchHistoryShares.watchHistoryId, watchHistory.id)
        )
        .where(and(sharedWhereBase, pairScope));

      const matchedHistoryIds = Array.from(
        new Set(matchedHistoryIdsRows.map((row) => row.history_id))
      );

      if (matchedHistoryIds.length > 0) {
      sharedRows = await db
        .select({
          history_id: watchHistory.id,
          tmdb_id: watchHistory.tmdbId,
          media_type: watchHistory.mediaType,
          season_number: watchHistory.seasonNumber,
          episode_number: watchHistory.episodeNumber,
          watched_at: watchHistory.watchedAt,
          owner_id: watchHistoryShares.ownerId,
          target_user_id: watchHistoryShares.targetUserId,
        })
        .from(watchHistoryShares)
        .innerJoin(
          watchHistory,
          eq(watchHistoryShares.watchHistoryId, watchHistory.id)
        )
        .where(
          and(
            sharedWhereBase,
            inArray(watchHistory.id, matchedHistoryIds),
            selectedFriendId === "all" ? undefined : pairScope
          )
        );
      }
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
      history_id: row.history_id,
      media_type: isHistoryMediaType(row.media_type) ? row.media_type : null,
      tmdb_id: row.tmdb_id,
      season_number: row.season_number,
      episode_number: row.episode_number,
      owner_id: "owner_id" in row ? row.owner_id : viewerId,
      companion_id:
        "target_user_id" in row
          ? row.target_user_id
          : null,
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
