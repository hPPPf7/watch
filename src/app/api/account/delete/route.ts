import { NextResponse } from "next/server";
import { eq, inArray, or } from "drizzle-orm";
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
    const userHistoryRows = await db
      .select({ id: watchHistory.id })
      .from(watchHistory)
      .where(eq(watchHistory.userId, userId));
    const userHistoryIds = userHistoryRows.map((row) => row.id);

    await db
      .delete(watchHistoryShares)
      .where(
        or(
          eq(watchHistoryShares.ownerId, userId),
          eq(watchHistoryShares.targetUserId, userId)
        )
      );

    if (userHistoryIds.length > 0) {
      await db
        .delete(watchHistoryShares)
        .where(inArray(watchHistoryShares.watchHistoryId, userHistoryIds));
    }

    await db.delete(watchHistory).where(eq(watchHistory.userId, userId));

    await db.delete(watchlistTvStates).where(eq(watchlistTvStates.userId, userId));

    await db.delete(watchlistItems).where(eq(watchlistItems.userId, userId));

    await db
      .delete(friendRequests)
      .where(
        or(eq(friendRequests.fromUserId, userId), eq(friendRequests.toUserId, userId))
      );

    await db
      .delete(friends)
      .where(or(eq(friends.userId, userId), eq(friends.friendId, userId)));

    await db.delete(authUserMap).where(eq(authUserMap.userId, userId));
    await db.delete(profiles).where(eq(profiles.id, userId));
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
        details,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
