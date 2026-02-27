import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { friends, watchHistory, watchHistoryShares } from "@/server/db/schema";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  season?: number;
  episode?: number;
  watchedAt?: string;
  friendIds?: string[];
};

const isValidDateOnly = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
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
  const season = body?.season ?? 0;
  const episode = body?.episode ?? 0;
  const watchedAt = body?.watchedAt;
  const friendIds = Array.isArray(body?.friendIds) ? body!.friendIds : [];
  const projectId = "watch";

  if (
    (mediaType !== "movie" && mediaType !== "tv") ||
    !tmdbId ||
    !watchedAt ||
    !isValidDateOnly(watchedAt) ||
    friendIds.some((id) => typeof id !== "string" || !id)
  ) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
    );
  }

  if (friendIds.length === 0) {
    return NextResponse.json({ conflictFriendIds: [] as string[] });
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
    const allowedFriendIds = allowedFriendRows.map((row) => row.friendId);

    if (allowedFriendIds.length === 0) {
      return NextResponse.json({ conflictFriendIds: [] as string[] });
    }

    const watchedDate = new Date(`${watchedAt}T00:00:00.000Z`);

    const ownRows = await db
      .select({ userId: watchHistory.userId })
      .from(watchHistory)
      .where(
        and(
          eq(watchHistory.projectId, projectId),
          inArray(watchHistory.userId, allowedFriendIds),
          eq(watchHistory.mediaType, mediaType),
          eq(watchHistory.tmdbId, tmdbId),
          eq(watchHistory.seasonNumber, season),
          eq(watchHistory.episodeNumber, episode),
          eq(watchHistory.watchedAt, watchedDate)
        )
      );

    const sharedRows = await db
      .select({ targetUserId: watchHistoryShares.targetUserId })
      .from(watchHistoryShares)
      .innerJoin(
        watchHistory,
        eq(watchHistory.id, watchHistoryShares.watchHistoryId)
      )
      .where(
        and(
          eq(watchHistoryShares.projectId, projectId),
          inArray(watchHistoryShares.targetUserId, allowedFriendIds),
          eq(watchHistory.mediaType, mediaType),
          eq(watchHistory.tmdbId, tmdbId),
          eq(watchHistory.seasonNumber, season),
          eq(watchHistory.episodeNumber, episode),
          eq(watchHistory.watchedAt, watchedDate)
        )
      );

    const conflictSet = new Set<string>();
    ownRows.forEach((row) => conflictSet.add(row.userId));
    sharedRows.forEach((row) => conflictSet.add(row.targetUserId));

    return NextResponse.json({ conflictFriendIds: Array.from(conflictSet) });
  } catch (error) {
    console.error("[detail/history-conflicts] failed", { userId, error });
    return NextResponse.json(
      {
        code: "CHECK_FAILED",
        message: "Check conflicts failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
