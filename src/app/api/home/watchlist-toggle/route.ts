import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchHistory, watchHistoryShares, watchlistItems } from "@/server/db/schema";
import { publishScopedWatchUpdates } from "@/server/realtime/watchUpdates";

const PROJECT_ID = "watch";

type Body = {
  action?: "add" | "remove";
  item?: {
    type: "movie" | "tv";
    id: number;
    title: string;
    year: string | null;
    releaseDate: string | null;
    posterPath: string | null;
    isAnime: boolean;
  };
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

  const body = (await request.json().catch(() => null)) as Body | null;
  const action = body?.action;
  const item = body?.item;

  if (!action || !item || (item.type !== "movie" && item.type !== "tv")) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
    );
  }

  if (action === "remove") {
    const existingItems = await db
      .select({ id: watchlistItems.id, isAnime: watchlistItems.isAnime })
      .from(watchlistItems)
      .where(
        and(
          eq(watchlistItems.userId, userId),
          eq(watchlistItems.projectId, PROJECT_ID),
          eq(watchlistItems.mediaType, item.type),
          eq(watchlistItems.tmdbId, item.id)
        )
      );

    const existingHistory = await db
      .select({ id: watchHistory.id })
      .from(watchHistory)
      .where(
        and(
          eq(watchHistory.userId, userId),
          eq(watchHistory.projectId, PROJECT_ID),
          eq(watchHistory.mediaType, item.type),
          eq(watchHistory.tmdbId, item.id)
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
          eq(watchHistoryShares.projectId, PROJECT_ID),
          eq(watchHistoryShares.targetUserId, userId),
          eq(watchHistory.projectId, PROJECT_ID),
          eq(watchHistory.mediaType, item.type),
          eq(watchHistory.tmdbId, item.id)
        )
      )
      .limit(1);

    if (existingHistory.length > 0 || sharedHistory.length > 0) {
      // 「想看」在這裡是追蹤清單中的「未看」狀態，不是可隨意清空的暫存箱。
      // 作品一旦已有紀錄就不能移出清單，否則使用者會看不到這部作品的追蹤進度。
      return NextResponse.json(
        {
          code: "WATCH_HISTORY_EXISTS",
          message: "watch_history_exists",
        },
        { status: 409 }
      );
    }

    await db
      .delete(watchlistItems)
      .where(
        and(
          eq(watchlistItems.userId, userId),
          eq(watchlistItems.projectId, PROJECT_ID),
          eq(watchlistItems.mediaType, item.type),
          eq(watchlistItems.tmdbId, item.id)
        )
      );
    await publishScopedWatchUpdates(
      [
        {
          userId,
          revisionScopes: Array.from(
            new Set(
              existingItems.map((existingItem) =>
                `${item.type}:${item.type === "tv" && existingItem.isAnime === 1 ? 1 : 0}`
              )
            )
          ).map((scopeKey) => {
            const [, animeFlag] = scopeKey.split(":");
            return {
              mediaType: item.type,
              isAnime: animeFlag === "1",
            };
          }),
        },
      ],
      "home_watchlist_remove",
    );
    return NextResponse.json({ ok: true });
  }

  const existing = await db
    .select({ id: watchlistItems.id, isAnime: watchlistItems.isAnime })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, userId),
        eq(watchlistItems.projectId, PROJECT_ID),
        eq(watchlistItems.mediaType, item.type),
        eq(watchlistItems.tmdbId, item.id)
      )
    )
    ;

  if (existing.length === 0) {
    await db.insert(watchlistItems).values({
      userId,
      projectId: PROJECT_ID,
      mediaType: item.type,
      tmdbId: item.id,
      isAnime: item.isAnime ? 1 : 0,
    });
    await publishScopedWatchUpdates(
      [
        {
          userId,
          revisionScopes: [
            { mediaType: item.type, isAnime: item.type === "tv" ? item.isAnime : false },
          ],
        },
      ],
      "home_watchlist_add",
    );
  } else if (item.type === "tv") {
    const nextIsAnime = item.isAnime ? 1 : 0;
    const previousScopes = Array.from(
      new Set(existing.map((row) => row.isAnime))
    ).map((isAnimeFlag) => ({
      mediaType: "tv" as const,
      isAnime: isAnimeFlag === 1,
    }));
    const keepRow =
      existing.find((row) => row.isAnime === nextIsAnime) ?? existing[0];
    const duplicateIds = existing
      .filter((row) => row.id !== keepRow.id)
      .map((row) => row.id);
    const needsUpdate = keepRow.isAnime !== nextIsAnime;

    if (needsUpdate) {
      await db
        .update(watchlistItems)
        .set({ isAnime: nextIsAnime })
        .where(eq(watchlistItems.id, keepRow.id));
    }

    if (duplicateIds.length > 0) {
      await db
        .delete(watchlistItems)
        .where(inArray(watchlistItems.id, duplicateIds));
    }

    if (needsUpdate || duplicateIds.length > 0) {
      await publishScopedWatchUpdates(
        [
          {
            userId,
            revisionScopes: [
              ...previousScopes,
              { mediaType: "tv", isAnime: item.isAnime },
            ],
          },
        ],
        "home_watchlist_reclassify",
      );
    }
  }

  return NextResponse.json({ ok: true });
}
