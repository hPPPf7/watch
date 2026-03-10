import { NextResponse } from "next/server";
import { eq, or, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { publishWatchUpdates } from "@/server/realtime/watchUpdates";
import {
  authUserMap,
  deletedAccountMarkers,
  deletedAuthAccountMarkers,
  friendRequests,
  friends,
  profiles,
  watchHistory,
  watchHistoryShares,
  watchlistItems,
  watchlistTvStates,
} from "@/server/db/schema";

const PERMANENT_MARKER_EXPIRES_AT = new Date("9999-12-31T23:59:59.999Z");

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
    const authMappings = await db
      .select({
        provider: authUserMap.provider,
        providerAccountId: authUserMap.providerAccountId,
      })
      .from(authUserMap)
      .where(eq(authUserMap.userId, userId));
    const authMarkerRows =
      authMappings.length > 0
        ? authMappings
        : session.user.auth_provider && session.user.auth_provider_account_id
          ? [
              {
                provider: session.user.auth_provider,
                providerAccountId: session.user.auth_provider_account_id,
              },
            ]
          : [];

    if (authMarkerRows.length === 0) {
      return NextResponse.json(
        {
          code: "REAUTH_REQUIRED",
          message: "Please sign in again before deleting your account.",
        },
        { status: 409 },
      );
    }

    const shareRows = await db
      .select({
        ownerId: watchHistoryShares.ownerId,
        targetUserId: watchHistoryShares.targetUserId,
      })
      .from(watchHistoryShares)
      .where(
        or(
          eq(watchHistoryShares.ownerId, userId),
          eq(watchHistoryShares.targetUserId, userId)
        )
      );
    const affectedUserIds = Array.from(
      new Set(
        shareRows
          .map((row) =>
            row.ownerId === userId ? row.targetUserId : row.ownerId
          )
          .filter((targetUserId) => targetUserId !== userId)
      )
    );

    await db.transaction(async (tx) => {
      // 刪除帳戶規則：
      // 1. 刪除後不可復原，自己的清單與觀看紀錄全部移除。
      // 2. 自己建立的同步紀錄會連同所有被分享關係一起移除。
      // 3. 他人建立並分享給自己的同步紀錄會保留，但會從其中移除自己。
      await tx.execute(sql`
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

      const now = new Date();
      await tx
        .insert(deletedAccountMarkers)
        .values({
          userId,
          expiresAt: PERMANENT_MARKER_EXPIRES_AT,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: deletedAccountMarkers.userId,
          set: {
            expiresAt: PERMANENT_MARKER_EXPIRES_AT,
            updatedAt: now,
          },
        });

      if (authMarkerRows.length > 0) {
        await tx
          .insert(deletedAuthAccountMarkers)
          .values(
            authMarkerRows.map((row) => ({
              provider: row.provider,
              providerAccountId: row.providerAccountId,
              userId,
              expiresAt: PERMANENT_MARKER_EXPIRES_AT,
              updatedAt: now,
            })),
          )
          .onConflictDoUpdate({
            target: [
              deletedAuthAccountMarkers.provider,
              deletedAuthAccountMarkers.providerAccountId,
            ],
            set: {
              userId,
              expiresAt: PERMANENT_MARKER_EXPIRES_AT,
              updatedAt: now,
            },
          });
      }
    });

    if (affectedUserIds.length > 0) {
      try {
        await publishWatchUpdates(
          affectedUserIds,
          "account_delete_history_share_cleanup"
        );
      } catch (error) {
        console.warn("[account/delete] failed to publish watch updates", {
          userId,
          error,
        });
      }
    }
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

  const response = NextResponse.json({ ok: true });

  // 刪除整個帳號後，直接使目前 JWT session cookie 失效，避免舊 session 再把資料建回來。
  const expired = new Date(0);
  const baseCookieNames = [
    "authjs.session-token",
    "__Secure-authjs.session-token",
    "next-auth.session-token",
    "__Secure-next-auth.session-token",
  ];
  const cookieNames = new Set(baseCookieNames);
  const requestCookieNames = request.headers
    .get("cookie")
    ?.split(";")
    .map((cookie) => cookie.trim().split("=")[0]?.trim())
    .filter(
      (name): name is string =>
        Boolean(name) &&
        baseCookieNames.some(
          (baseName) => name === baseName || name.startsWith(`${baseName}.`),
        ),
    ) ?? [];

  for (const name of requestCookieNames) {
    cookieNames.add(name);
  }

  for (const name of cookieNames) {
    response.cookies.set(name, "", {
      expires: expired,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: name.startsWith("__Secure-"),
    });
  }

  return response;
}
