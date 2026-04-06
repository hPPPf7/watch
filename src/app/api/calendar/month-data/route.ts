import { NextResponse } from "next/server";
import { and, eq, gte, inArray, lt, notExists, or } from "drizzle-orm";
import { auth } from "@/auth";
import { getCalendarGridRange } from "@/lib/calendarDate";
import { extractDateOnlyKey } from "@/lib/calendarDate";
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
  const selectedFriendId = body?.selectedFriendId ?? "all";
  const scope = body?.scope ?? "month";

  if (
    typeof year !== "number" ||
    typeof month !== "number" ||
    month < 0 ||
    month > 11 ||
    (scope !== "month" && scope !== "grid") ||
    (selectedFriendId !== "all" &&
      selectedFriendId !== "self" &&
      !isUuidString(selectedFriendId))
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
  if (selectedFriendId !== "all" && selectedFriendId !== "self") {
    const friendRow = await db
      .select({ friend_id: friends.friendId })
      .from(friends)
      .where(
        and(
          eq(friends.userId, viewerId),
          eq(friends.friendId, selectedFriendId),
        ),
      )
      .limit(1);
    if (friendRow.length === 0) {
      return NextResponse.json(
        { code: "FORBIDDEN", message: "Friend is not accessible" },
        { status: 403 },
      );
    }
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

  const visibleFriendIds =
    selectedFriendId !== "all"
      ? []
      : await db
          .select({ friend_id: friends.friendId })
          .from(friends)
          .where(
            and(eq(friends.userId, viewerId))
          )
          .then((rows) => rows.map((row) => row.friend_id));
  const visibleParticipantIds = new Set([viewerId, ...visibleFriendIds]);

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
            // 「所有紀錄」先用 pairScope 決定這筆 history 是否和 viewer 有關；
            // 一旦確認這筆共同觀看屬於 viewer 的月曆，就要保留它的完整 share rows。
            // 但回傳 payload 仍只應包含 viewer 目前可見的 participant rows，避免把
            // 非好友的第三人 user id 洩到前端；之後若成為好友，下一次重新載入月曆
            // 就會依最新好友關係自動補回可顯示的參與者。
            selectedFriendId === "all" ? undefined : pairScope
          )
        );
      if (selectedFriendId === "all") {
        sharedRows = sharedRows.filter(
          (row) =>
            visibleParticipantIds.has(row.owner_id) &&
            visibleParticipantIds.has(row.target_user_id),
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
        row.watched_at instanceof Date
          ? row.watched_at.toISOString().slice(0, 10)
          : (extractDateOnlyKey(String(row.watched_at)) ?? String(row.watched_at).slice(0, 10)),
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
