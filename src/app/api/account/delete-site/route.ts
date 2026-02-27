import { NextResponse } from "next/server";
import { and, eq, inArray, or } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import {
  friendRequests,
  friends,
  watchHistory,
  watchHistoryShares,
  watchlistItems,
  watchlistTvStates,
} from "@/server/db/schema";

const PROJECT_ID = "watch";

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
    await db.transaction(async (tx) => {
      const userHistoryRows = await tx
        .select({ id: watchHistory.id })
        .from(watchHistory)
        .where(
          and(
            eq(watchHistory.projectId, PROJECT_ID),
            eq(watchHistory.userId, userId)
          )
        );
      const userHistoryIds = userHistoryRows.map((row) => row.id);

      await tx
        .delete(watchHistoryShares)
        .where(
          and(
            eq(watchHistoryShares.projectId, PROJECT_ID),
            or(
              eq(watchHistoryShares.ownerId, userId),
              eq(watchHistoryShares.targetUserId, userId)
            )
          )
        );

      if (userHistoryIds.length > 0) {
        await tx
          .delete(watchHistoryShares)
          .where(
            and(
              eq(watchHistoryShares.projectId, PROJECT_ID),
              inArray(watchHistoryShares.watchHistoryId, userHistoryIds)
            )
          );
      }

      await tx
        .delete(watchHistory)
        .where(
          and(
            eq(watchHistory.projectId, PROJECT_ID),
            eq(watchHistory.userId, userId)
          )
        );

      await tx
        .delete(watchlistTvStates)
        .where(
          and(
            eq(watchlistTvStates.projectId, PROJECT_ID),
            eq(watchlistTvStates.userId, userId)
          )
        );

      await tx
        .delete(watchlistItems)
        .where(
          and(
            eq(watchlistItems.projectId, PROJECT_ID),
            eq(watchlistItems.userId, userId)
          )
        );

      await tx
        .delete(friendRequests)
        .where(
          and(
            eq(friendRequests.projectId, PROJECT_ID),
            or(
              eq(friendRequests.fromUserId, userId),
              eq(friendRequests.toUserId, userId)
            )
          )
        );

      await tx
        .delete(friends)
        .where(
          and(
            eq(friends.projectId, PROJECT_ID),
            or(eq(friends.userId, userId), eq(friends.friendId, userId))
          )
        );
    });
  } catch (error) {
    console.error("[account/delete-site] delete failed", { userId, error });
    return NextResponse.json(
      {
        code: "DELETE_FAILED",
        message: "Delete failed",
        ...(process.env.NODE_ENV !== "production" && error instanceof Error
          ? { details: error.message }
          : {}),
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
