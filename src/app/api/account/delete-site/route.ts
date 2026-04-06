import { NextResponse } from "next/server";
import { and, eq, or, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { publishWatchUpdates } from "@/server/realtime/watchUpdates";
import { runBestEffortPublish } from "@/server/realtime/safePublish";
import {
  friendRequests,
  friends,
  watchHistory,
  watchHistoryShares,
  watchlistItems,
  watchlistTvStates,
} from "@/server/db/schema";

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Unauthorized" },
      { status: 401 }
    );
  }
  void request;

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
    const shareRows = await db
      .select({
        ownerId: watchHistoryShares.ownerId,
        targetUserId: watchHistoryShares.targetUserId,
      })
      .from(watchHistoryShares)
      .where(
        and(
          or(
            eq(watchHistoryShares.ownerId, userId),
            eq(watchHistoryShares.targetUserId, userId)
          )
        )
      );
    const affectedUserIds = Array.from(
      new Set(
        [
          userId,
          ...shareRows
          .map((row) =>
            row.ownerId === userId ? row.targetUserId : row.ownerId
          )
          .filter((targetUserId) => targetUserId !== userId),
        ]
      )
    );

    // 刪除站內資料規則：
    // 1. 自己建立的觀看紀錄、清單與同步分享關係全部移除。
    // 2. 他人建立但分享給自己的同步紀錄會保留原紀錄，只把自己從分享關係中移除。
    await db.execute(sql`
      WITH user_history AS (
        SELECT id
        FROM ${watchHistory}
        WHERE ${watchHistory.userId} = ${userId}
      ),
      del_watch_history_shares_by_history AS (
        DELETE FROM ${watchHistoryShares}
        WHERE ${watchHistoryShares.watchHistoryId} IN (SELECT id FROM user_history)
      ),
      del_watch_history_shares_direct AS (
        DELETE FROM ${watchHistoryShares}
        WHERE (
            ${watchHistoryShares.ownerId} = ${userId}
            OR ${watchHistoryShares.targetUserId} = ${userId}
          )
      ),
      del_watch_history AS (
        DELETE FROM ${watchHistory}
        WHERE ${watchHistory.userId} = ${userId}
      ),
      del_watchlist_tv_states AS (
        DELETE FROM ${watchlistTvStates}
        WHERE ${watchlistTvStates.userId} = ${userId}
      ),
      del_watchlist_items AS (
        DELETE FROM ${watchlistItems}
        WHERE ${watchlistItems.userId} = ${userId}
      ),
      del_friend_requests AS (
        DELETE FROM ${friendRequests}
        WHERE (
            ${friendRequests.fromUserId} = ${userId}
            OR ${friendRequests.toUserId} = ${userId}
          )
      ),
      del_friends AS (
        DELETE FROM ${friends}
        WHERE (
            ${friends.userId} = ${userId}
            OR ${friends.friendId} = ${userId}
          )
      )
      SELECT 1;
    `);

    await runBestEffortPublish("account/delete-site", async () => {
      if (affectedUserIds.length > 0) {
        await publishWatchUpdates(
          affectedUserIds,
          "account_delete_site_history_share_cleanup"
        );
      }
    });
  } catch (error) {
    console.error("[account/delete-site] delete failed", { userId, error });
    const details =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : JSON.stringify(error);
    return NextResponse.json(
      {
        code: "DELETE_FAILED",
        message: "Delete failed",
        ...(process.env.NODE_ENV !== "production" ? { details } : {}),
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
