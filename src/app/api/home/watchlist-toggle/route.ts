import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import {
  watchHistory,
  watchHistoryShares,
  watchlistItems,
} from "@/server/db/schema";
import { publishScopedWatchUpdates } from "@/server/realtime/watchUpdates";
import { runBestEffortPublish } from "@/server/realtime/safePublish";
import { removeWatchlistItemsAndCleanupTvState } from "@/server/services/watchlistRemovalService";
import { mutateWatchlistItem } from "@/server/services/watchlistItemMutationService";

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

  if (
    (action !== "add" && action !== "remove") ||
    !item ||
    (item.type !== "movie" && item.type !== "tv") ||
    !isPositiveInteger(item.id)
  ) {
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
          eq(watchHistoryShares.targetUserId, userId),
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

    const requestedIsAnime = item.type === "tv" ? item.isAnime : false;
    const deleteTargets =
      item.type === "tv"
        ? (() => {
            const matching = existingItems.filter(
              (existingItem) => (existingItem.isAnime === 1) === requestedIsAnime
            );
            if (matching.length > 0) return matching;
            return existingItems.length === 1 ? existingItems : [];
          })()
        : existingItems;

    if (deleteTargets.length > 0) {
      await removeWatchlistItemsAndCleanupTvState({
        userId,
        mediaType: item.type,
        tmdbId: item.id,
        itemIds: deleteTargets.map((row) => row.id),
      });
    }
    await runBestEffortPublish("home/watchlist-toggle:remove", async () => {
      await publishScopedWatchUpdates([userId], "home_watchlist_remove");
    });
    const affectedIsAnime = Array.from(
      new Set(
        deleteTargets.map((row) => item.type === "tv" && row.isAnime === 1)
      )
    );
    return NextResponse.json({
      ok: true,
      affectedIsAnime:
        affectedIsAnime.length > 0
          ? affectedIsAnime
          : [item.type === "tv" ? item.isAnime : false],
    });
  }

  const result = await mutateWatchlistItem({
    userId,
    mediaType: item.type,
    tmdbId: item.id,
    isAnime: item.isAnime,
  });

  if (result.changed) {
    await runBestEffortPublish(
      `home/watchlist-toggle:${result.changeKind}`,
      async () => {
        await publishScopedWatchUpdates(
          [userId],
          result.changeKind === "add"
            ? "home_watchlist_add"
            : "home_watchlist_reclassify",
        );
      },
    );
  }

  return NextResponse.json({
    ok: true,
    affectedIsAnime: result.affectedIsAnime,
  });
}
