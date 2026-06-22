import { NextResponse } from "next/server";
import { and, eq, gte, inArray, lt, notExists, or, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { extractDateOnlyKey, getCalendarGridRange } from "@/lib/calendarDate";
import { isUuidString } from "@/lib/uuid";
import { getDb } from "@/server/db/client";
import {
  friends,
  watchHistory,
  watchHistoryShares,
  watchlistItems,
} from "@/server/db/schema";
import { getCalendarMetadata } from "@/server/tmdb/calendarMetadata";

type Body = {
  year?: number;
  month?: number;
  selectedFriendId?: string;
  selectedFriendIds?: string[];
  scope?: "month" | "grid";
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

type MetadataItem = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  is_anime: boolean;
};

const isHistoryMediaType = (value: string): value is "movie" | "tv" =>
  value === "movie" || value === "tv";
const METADATA_CONCURRENCY = 6;

async function runWithConcurrencyLimit<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  if (items.length === 0) {
    return;
  }

  let nextIndex = 0;
  const runWorker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex]!);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  );
}

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
  const legacySelectedFriendId = body?.selectedFriendId ?? "all";
  const selectedFriendIds = Array.isArray(body?.selectedFriendIds)
    ? Array.from(new Set(body.selectedFriendIds))
    : legacySelectedFriendId !== "all" && legacySelectedFriendId !== "self"
      ? [legacySelectedFriendId]
      : [];
  const selectedFriendId =
    selectedFriendIds.length > 0 ? "friends" : legacySelectedFriendId;
  const scope = body?.scope ?? "month";

  if (
    typeof year !== "number" ||
    typeof month !== "number" ||
    month < 0 ||
    month > 11 ||
    (scope !== "month" && scope !== "grid") ||
    (selectedFriendId !== "all" &&
      selectedFriendId !== "self" &&
      selectedFriendId !== "friends") ||
    selectedFriendIds.some((id) => !isUuidString(id))
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

  const range =
    scope === "grid"
      ? getCalendarGridRange(year, month)
      : {
          startDate: new Date(year, month, 1),
          endExclusive: new Date(year, month + 1, 1),
        };
  const start = new Date(
    Date.UTC(
      range.startDate.getFullYear(),
      range.startDate.getMonth(),
      range.startDate.getDate(),
    ),
  );
  const endExclusive = new Date(
    Date.UTC(
      range.endExclusive.getFullYear(),
      range.endExclusive.getMonth(),
      range.endExclusive.getDate(),
    ),
  );
  const viewerId = session.user.id;
  const visibleFriendIds =
    selectedFriendId === "self"
      ? []
      : await db
          .select({ friend_id: friends.friendId })
          .from(friends)
          .where(
            and(eq(friends.userId, viewerId))
          )
          .then((rows) => rows.map((row) => row.friend_id));
  const visibleFriendIdSet = new Set(visibleFriendIds);
  if (
    selectedFriendIds.length > 0 &&
    selectedFriendIds.some((id) => !visibleFriendIdSet.has(id))
  ) {
    return NextResponse.json(
      { code: "FORBIDDEN", message: "Friend is not accessible" },
      { status: 403 },
    );
  }
  const sharedWithViewerScope = or(
    eq(watchHistoryShares.ownerId, viewerId),
    eq(watchHistoryShares.targetUserId, viewerId)
  );
  const ownRowsWhere = and(
    eq(watchHistory.userId, viewerId),
    gte(watchHistory.watchedAt, start),
    lt(watchHistory.watchedAt, endExclusive)
  );
  // 「自己單獨看」定義為沒有任何共同觀看分享關係的紀錄。
  // 一旦自己的紀錄已分享給好友，就會刻意排除在這個篩選之外，
  // 讓它和「所有人」維持明確區別。
  const soloOwnRowsWhere = and(
    eq(watchHistory.userId, viewerId),
    gte(watchHistory.watchedAt, start),
    lt(watchHistory.watchedAt, endExclusive),
    notExists(
      db
        .select({ id: watchHistoryShares.id })
        .from(watchHistoryShares)
        .where(
          and(
            eq(watchHistoryShares.watchHistoryId, watchHistory.id),
            sharedWithViewerScope
          )
        )
    )
  );
  const dedupedAllOwnRowsWhere = and(
    eq(watchHistory.userId, viewerId),
    gte(watchHistory.watchedAt, start),
    lt(watchHistory.watchedAt, endExclusive),
    notExists(
      db
        .select({ id: watchHistoryShares.id })
        .from(watchHistoryShares)
        .where(
          and(
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
      watched_at: sql<string>`((${watchHistory.watchedAt} AT TIME ZONE 'UTC')::date)::text`,
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

  const visibleParticipantIds = new Set([viewerId, ...visibleFriendIds]);

  let sharedRows: Array<{
    history_id: string;
    tmdb_id: number;
    media_type: string;
    season_number: number | null;
    episode_number: number | null;
    watched_at: string;
    owner_id: string;
    target_user_id: string;
  }> = [];

  if (selectedFriendId !== "self") {
    const sharedWhereBase = and(
      gte(watchHistory.watchedAt, start),
      lt(watchHistory.watchedAt, endExclusive)
    );

    const pairScope = or(
      eq(watchHistoryShares.ownerId, viewerId),
      eq(watchHistoryShares.targetUserId, viewerId)
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
            watched_at: sql<string>`((${watchHistory.watchedAt} AT TIME ZONE 'UTC')::date)::text`,
            owner_id: watchHistoryShares.ownerId,
            target_user_id: watchHistoryShares.targetUserId,
          })
          .from(watchHistoryShares)
          .innerJoin(
            watchHistory,
            eq(watchHistoryShares.watchHistoryId, watchHistory.id)
          )
          .where(and(sharedWhereBase, inArray(watchHistory.id, matchedHistoryIds)));

        sharedRows = sharedRows.filter(
          (row) =>
            visibleParticipantIds.has(row.owner_id) &&
            visibleParticipantIds.has(row.target_user_id),
        );

        if (selectedFriendIds.length > 0) {
          const participantIdsByHistoryId = new Map<string, Set<string>>();
          sharedRows.forEach((row) => {
            const participantIds =
              participantIdsByHistoryId.get(row.history_id) ?? new Set<string>();
            participantIds.add(row.owner_id);
            participantIds.add(row.target_user_id);
            participantIdsByHistoryId.set(row.history_id, participantIds);
          });
          const filteredHistoryIds = new Set(
            Array.from(participantIdsByHistoryId.entries())
              .filter(([, participantIds]) =>
                selectedFriendIds.every((id) => participantIds.has(id)),
              )
              .map(([historyId]) => historyId),
          );
          sharedRows = sharedRows.filter((row) =>
            filteredHistoryIds.has(row.history_id),
          );
        }
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
        extractDateOnlyKey(String(row.watched_at)) ??
        String(row.watched_at).slice(0, 10),
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
              eq(watchlistItems.mediaType, "tv"),
              inArray(watchlistItems.tmdbId, tvIds)
            )
          );

  const metadataByKey = new Map<string, MetadataItem>();

  movieItemsRaw.forEach((item) => {
    metadataByKey.set(`movie:${item.tmdb_id}`, {
      tmdb_id: item.tmdb_id,
      media_type: "movie",
      title: "",
      is_anime: false,
    });
  });
  tvItemsRaw.forEach((item) => {
    metadataByKey.set(`tv:${item.tmdb_id}`, {
      tmdb_id: item.tmdb_id,
      media_type: "tv",
      title: "",
      is_anime: Boolean(item.is_anime),
    });
  });

  mergedRows.forEach((row) => {
    const key = `${row.media_type}:${row.tmdb_id}`;
    if (metadataByKey.has(key)) return;
    metadataByKey.set(key, {
      tmdb_id: row.tmdb_id,
      media_type: row.media_type,
      title: "",
      is_anime: false,
    });
  });

  await runWithConcurrencyLimit(
    Array.from(metadataByKey.values()),
    METADATA_CONCURRENCY,
    async (item) => {
      const metadata = await getCalendarMetadata(item.media_type, item.tmdb_id);
      if (!metadata) return;
      item.title = metadata.title ?? "";
      if (item.media_type === "tv") {
        item.is_anime = metadata.isAnime;
      }
    },
  );

  const movieItems = Array.from(metadataByKey.values()).filter(
    (item): item is MetadataItem => item.media_type === "movie",
  );
  const tvItems = Array.from(metadataByKey.values()).filter(
    (item): item is MetadataItem => item.media_type === "tv",
  );

  return NextResponse.json({
    rows: mergedRows,
    movie_items: movieItems,
    tv_items: tvItems,
  });
}
