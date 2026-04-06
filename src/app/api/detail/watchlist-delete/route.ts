import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchHistory, watchHistoryShares, watchlistItems } from "@/server/db/schema";
import { runBestEffortPublish } from "@/server/realtime/safePublish";
import { publishScopedWatchUpdates } from "@/server/realtime/watchUpdates";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  isAnime?: boolean;
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
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

  const body = (await request.json().catch(() => null)) as Body | null;
  const mediaType = body?.mediaType;
  const tmdbId = body?.tmdbId;
  const isAnime = body?.isAnime ?? false;

  if ((mediaType !== "movie" && mediaType !== "tv") || !isPositiveInteger(tmdbId)) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
    );
  }
  const validatedTmdbId = tmdbId;

  let db;
  try {
    db = getDb();
  } catch {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "DATABASE_URL is required" },
      { status: 500 }
    );
  }

  const existingHistory = await db
    .select({ id: watchHistory.id })
    .from(watchHistory)
    .where(
      and(
        eq(watchHistory.userId, userId),
        eq(watchHistory.mediaType, mediaType),
        eq(watchHistory.tmdbId, validatedTmdbId)
      )
    )
    .limit(1);

  const sharedHistory = await db
    .select({ id: watchHistory.id })
    .from(watchHistoryShares)
    .innerJoin(
      watchHistory,
      eq(watchHistory.id, watchHistoryShares.watchHistoryId)
    )
    .where(
      and(
        eq(watchHistoryShares.targetUserId, userId),
        eq(watchHistory.mediaType, mediaType),
        eq(watchHistory.tmdbId, validatedTmdbId)
      )
    )
    .limit(1);

  if (existingHistory.length > 0 || sharedHistory.length > 0) {
    // 這個產品裡的清單項目是使用者持續追蹤的片庫條目。
    // 只要作品已有觀看紀錄，就必須保留在清單內，否則觀看進度會失去入口。
    return NextResponse.json(
      {
        code: "WATCH_HISTORY_EXISTS",
        message: "watch_history_exists",
      },
      { status: 409 }
    );
  }

  const existingItems = await db
    .select({ id: watchlistItems.id, isAnime: watchlistItems.isAnime })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, userId),
        eq(watchlistItems.mediaType, mediaType),
        eq(watchlistItems.tmdbId, validatedTmdbId),
        mediaType === "tv"
          ? eq(watchlistItems.isAnime, isAnime ? 1 : 0)
          : eq(watchlistItems.isAnime, 0)
      )
    );

  await db
    .delete(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, userId),
        eq(watchlistItems.mediaType, mediaType),
        eq(watchlistItems.tmdbId, validatedTmdbId),
        mediaType === "tv"
          ? eq(watchlistItems.isAnime, isAnime ? 1 : 0)
          : eq(watchlistItems.isAnime, 0)
      )
    );

  if (existingItems.length > 0) {
    await runBestEffortPublish("detail/watchlist-delete", async () => {
      await publishScopedWatchUpdates(
        [
          {
            userId,
            revisionScopes: Array.from(
              new Set(
                existingItems.map((item) =>
                  `${mediaType}:${mediaType === "tv" && item.isAnime === 1 ? 1 : 0}`
                )
              )
            ).map((scopeKey) => {
              const [, animeFlag] = scopeKey.split(":");
              return {
                mediaType,
                isAnime: animeFlag === "1",
              };
            }),
          },
        ],
        "watchlist_delete"
      );
    });
  }

  return NextResponse.json({ ok: true });
}
