import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { friends, watchlistItems } from "@/server/db/schema";
import { publishWatchUpdates } from "@/server/realtime/watchUpdates";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  isAnime?: boolean;
  friendIds?: string[];
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

  const body = (await request.json().catch(() => null)) as Body | null;
  const mediaType = body?.mediaType;
  const tmdbId = body?.tmdbId;
  const isAnime = body?.isAnime ?? false;
  const friendIds = Array.isArray(body?.friendIds) ? body!.friendIds : [];
  const projectId = "watch";

  if (
    (mediaType !== "movie" && mediaType !== "tv") ||
    !tmdbId ||
    friendIds.some((id) => typeof id !== "string" || !id)
  ) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
    );
  }

  if (friendIds.length === 0) {
    return NextResponse.json({ ok: true });
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

  try {
    const allowedFriendRows = await db
      .select({ friendId: friends.friendId })
      .from(friends)
      .where(
        and(
          eq(friends.projectId, projectId),
          eq(friends.userId, userId),
          inArray(friends.friendId, friendIds)
        )
      );
    const targetFriendIds = allowedFriendRows.map((row) => row.friendId);

    if (targetFriendIds.length === 0) {
      return NextResponse.json({ ok: true });
    }

    const affectedUsers = new Set<string>();
    let didChange = false;
    for (const targetUserId of targetFriendIds) {
      const existing = await db
        .select({ id: watchlistItems.id })
        .from(watchlistItems)
        .where(
          and(
            eq(watchlistItems.userId, targetUserId),
            eq(watchlistItems.projectId, projectId),
            eq(watchlistItems.mediaType, mediaType),
            eq(watchlistItems.tmdbId, tmdbId)
          )
        )
        .limit(1);

      if (!existing[0]) {
        await db.insert(watchlistItems).values({
          userId: targetUserId,
          projectId,
          mediaType,
          tmdbId,
          isAnime: isAnime ? 1 : 0,
        });
        affectedUsers.add(targetUserId);
        didChange = true;
      }
    }
    if (didChange) {
      await publishWatchUpdates(Array.from(affectedUsers), "history_sync_watchlist");
    }
  } catch (error) {
    console.error("[detail/history-sync-watchlist] failed", { userId, error });
    return NextResponse.json(
      {
        code: "SYNC_WATCHLIST_FAILED",
        message: "Sync watchlist failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
