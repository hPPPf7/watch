import { NextResponse } from "next/server";
import { eq, or, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { getAuthDb, getDb, runInAuthTransaction, runInTransaction } from "@/server/db/client";
import { acquireAuthUserLock, hasActiveAuthDeletionMarker } from "@/server/auth/accountLifecycle";
import { publishWatchUpdates } from "@/server/realtime/watchUpdates";
import {
  authSessionStates,
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

class AccountDeletionUnavailable extends Error {
  constructor(readonly code: "REAUTH_REQUIRED" | "ACCOUNT_DELETED") {
    super(code === "REAUTH_REQUIRED" ? "Please sign in again before deleting your account." : "Account has already been deleted.");
  }
}

const PERMANENT_MARKER_EXPIRES_AT = new Date("9999-12-31T23:59:59.999Z");

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Unauthorized" },
      { status: 401 },
    );
  }
  const expectedUserId = request.headers.get("x-watch-account-id");
  if (expectedUserId !== null && expectedUserId !== userId) {
    return NextResponse.json({ code: "ACCOUNT_CHANGED", message: "Account changed; confirm again" }, { status: 409 });
  }

  let db;
  try {
    db = getDb();
    getAuthDb();
  } catch (error) {
    const message = error instanceof Error ? error.message : "CONFIG_MISSING";
    return NextResponse.json(
      { code: "CONFIG_MISSING", message },
      { status: 500 },
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
        or(
          eq(watchHistoryShares.ownerId, userId),
          eq(watchHistoryShares.targetUserId, userId),
        ),
      );
    const affectedUserIds = Array.from(
      new Set(
        [
          userId,
          ...shareRows
            .map((row) => (row.ownerId === userId ? row.targetUserId : row.ownerId))
            .filter((targetUserId) => targetUserId !== userId),
        ],
      ),
    );

    const snapshot = await runInAuthTransaction(async (tx) => {
      await acquireAuthUserLock(tx, userId);
      const sessionIdentity = session.user.auth_provider && session.user.auth_provider_account_id
        ? { provider: session.user.auth_provider, providerAccountId: session.user.auth_provider_account_id }
        : undefined;
      if (await hasActiveAuthDeletionMarker(tx, userId, sessionIdentity)) {
        throw new AccountDeletionUnavailable("ACCOUNT_DELETED");
      }
      const authMappings = await tx
        .select({
          id: authUserMap.id,
          provider: authUserMap.provider,
          providerAccountId: authUserMap.providerAccountId,
          userId: authUserMap.userId,
          createdAt: authUserMap.createdAt,
        })
        .from(authUserMap)
        .where(eq(authUserMap.userId, userId));

      const [existingProfile] = await tx
        .select({
          id: profiles.id,
          nickname: profiles.nickname,
          providerNickname: profiles.providerNickname,
          avatarUrl: profiles.avatarUrl,
          createdAt: profiles.createdAt,
        })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);

      const [existingSessionState] = await tx
        .select({
          userId: authSessionStates.userId,
          sessionVersion: authSessionStates.sessionVersion,
          createdAt: authSessionStates.createdAt,
          updatedAt: authSessionStates.updatedAt,
        })
        .from(authSessionStates)
        .where(eq(authSessionStates.userId, userId))
        .limit(1);

      if (!existingSessionState) {
        throw new AccountDeletionUnavailable("REAUTH_REQUIRED");
      }
      const authMarkerRows = Array.from(new Map(
        [...authMappings, ...(sessionIdentity ? [sessionIdentity] : [])]
          .map((identity) => [JSON.stringify([identity.provider, identity.providerAccountId]), identity]),
      ).values());
      if (authMarkerRows.length === 0) {
        throw new AccountDeletionUnavailable("REAUTH_REQUIRED");
      }
      await tx.execute(sql`
        WITH del_auth_user_map AS (
          DELETE FROM ${authUserMap}
          WHERE ${authUserMap.userId} = ${userId}
        ),
        del_auth_session_state AS (
          DELETE FROM ${authSessionStates}
          WHERE ${authSessionStates.userId} = ${userId}
        ),
        del_profile AS (
          DELETE FROM ${profiles}
          WHERE ${profiles.id} = ${userId}
        )
        SELECT 1;
      `);

      const now = new Date();
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
      return { authMappings, existingProfile, existingSessionState };
    });

    try {
      await runInTransaction(async (tx) => {
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
      });
    } catch (watchDeleteError) {
      await runInAuthTransaction(async (tx) => {
        await acquireAuthUserLock(tx, userId);
        const { authMappings, existingProfile, existingSessionState } = snapshot;
        await tx.execute(sql`
          DELETE FROM ${deletedAuthAccountMarkers}
          WHERE ${deletedAuthAccountMarkers.userId} = ${userId}
        `);

        if (existingProfile) {
          await tx
            .insert(profiles)
            .values(existingProfile)
            .onConflictDoUpdate({
              target: profiles.id,
              set: {
                nickname: existingProfile.nickname,
                providerNickname: existingProfile.providerNickname,
                avatarUrl: existingProfile.avatarUrl,
              },
            });
        }

        if (existingSessionState) {
          await tx
            .insert(authSessionStates)
            .values(existingSessionState)
            .onConflictDoUpdate({
              target: authSessionStates.userId,
              set: {
                sessionVersion: existingSessionState.sessionVersion,
                updatedAt: existingSessionState.updatedAt,
              },
            });
        }

        if (authMappings.length > 0) {
          await tx
            .insert(authUserMap)
            .values(authMappings)
            .onConflictDoUpdate({
              target: [authUserMap.provider, authUserMap.providerAccountId],
              set: {
                userId,
              },
            });
        }
      });

      throw watchDeleteError;
    }

    if (affectedUserIds.length > 0) {
      try {
        await publishWatchUpdates(
          affectedUserIds,
          "account_delete_history_share_cleanup",
        );
      } catch (error) {
        console.warn("[account/delete] failed to publish watch updates", {
          userId,
          error,
        });
      }
    }
  } catch (error) {
    if (error instanceof AccountDeletionUnavailable) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: 409 });
    }
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
      { status: 500 },
    );
  }

  const response = NextResponse.json({ ok: true });

  const expired = new Date(0);
  const baseCookieNames = [
    "authjs.session-token",
    "__Secure-authjs.session-token",
    "next-auth.session-token",
    "__Secure-next-auth.session-token",
  ];
  const cookieNames = new Set(baseCookieNames);
  const requestCookieNames =
    request.headers
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
