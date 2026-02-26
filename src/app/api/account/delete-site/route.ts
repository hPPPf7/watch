import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
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

      await tx.delete(authUserMap).where(eq(authUserMap.userId, userId));
      await tx.delete(profiles).where(eq(profiles.id, userId));
    });
  } catch {
    return NextResponse.json(
      { code: "DELETE_FAILED", message: "Delete failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
