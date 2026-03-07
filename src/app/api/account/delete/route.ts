import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import {
  authUserMap,
  friendRequests,
  friends,
  profiles,
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
    // 刪除帳戶規則：
    // 1. 刪除後不可復原，自己的清單與觀看紀錄全部移除。
    // 2. 自己建立的同步紀錄會連同所有被分享關係一起移除。
    // 3. 他人建立並分享給自己的同步紀錄會保留，但會從其中移除自己。
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
        WHERE ${watchHistoryShares.ownerId} = ${userId}
           OR ${watchHistoryShares.targetUserId} = ${userId}
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
        WHERE ${friendRequests.fromUserId} = ${userId}
           OR ${friendRequests.toUserId} = ${userId}
      ),
      del_friends AS (
        DELETE FROM ${friends}
        WHERE ${friends.userId} = ${userId}
           OR ${friends.friendId} = ${userId}
      ),
      del_auth_user_map AS (
        DELETE FROM ${authUserMap}
        WHERE ${authUserMap.userId} = ${userId}
      ),
      del_profile AS (
        DELETE FROM ${profiles}
        WHERE ${profiles.id} = ${userId}
      )
      SELECT 1;
    `);
  } catch (error) {
    console.error("[account/delete] delete failed", { userId, error });
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
