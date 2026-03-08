import { NextResponse } from "next/server";
import { and, eq, inArray, ne } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { friends, watchHistory, watchHistoryShares } from "@/server/db/schema";
import { publishWatchUpdates } from "@/server/realtime/watchUpdates";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  season?: number;
  episode?: number;
  watchedAt?: string;
  friendIds?: string[];
};

const toUtcDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

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
  const watchedAt = body?.watchedAt;
  const friendIds = Array.isArray(body?.friendIds) ? body!.friendIds : [];
  const season = body?.season ?? 0;
  const episode = body?.episode ?? 0;
  const projectId = "watch";

  if (
    (mediaType !== "movie" && mediaType !== "tv") ||
    !tmdbId ||
    !watchedAt ||
    !/^\d{4}-\d{2}-\d{2}$/.test(watchedAt) ||
    friendIds.some((id) => typeof id !== "string" || !id)
  ) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
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

  try {
    const recordRows = await db
      .select({ id: watchHistory.id })
      .from(watchHistory)
      .where(
        and(
          eq(watchHistory.projectId, projectId),
          eq(watchHistory.userId, userId),
          eq(watchHistory.mediaType, mediaType),
          eq(watchHistory.tmdbId, tmdbId),
          eq(watchHistory.seasonNumber, season),
          eq(watchHistory.episodeNumber, episode),
          eq(watchHistory.watchedAt, toUtcDate(watchedAt))
        )
      )
      .limit(1);

    const watchRecord = recordRows[0];
    if (!watchRecord) {
      // 刪除流程可能會在觀看紀錄已被移除後才呼叫這裡。
      // 這種情況把同步分享視為無需任何變更的成功即可。
      return NextResponse.json({ ok: true });
    }

    const existingShareRows = await db
      .select({ targetUserId: watchHistoryShares.targetUserId })
      .from(watchHistoryShares)
      .where(
        and(
          eq(watchHistoryShares.projectId, projectId),
          eq(watchHistoryShares.ownerId, userId),
          eq(watchHistoryShares.watchHistoryId, watchRecord.id)
        )
      );
    const affectedUsers = new Set<string>(
      existingShareRows.map((row) => row.targetUserId)
    );

    const validFriendRows =
      friendIds.length === 0
        ? []
        : await db
            .select({ friendId: friends.friendId })
            .from(friends)
            .where(
              and(
                eq(friends.projectId, projectId),
                eq(friends.userId, userId),
                inArray(friends.friendId, friendIds)
              )
            );
    const validFriendIds = new Set(validFriendRows.map((row) => row.friendId));
    const targetIds = friendIds.filter((id) => validFriendIds.has(id));
    const nextTargetSet = new Set(targetIds);
    const prevTargetSet = new Set(existingShareRows.map((row) => row.targetUserId));
    const unchanged =
      nextTargetSet.size === prevTargetSet.size &&
      Array.from(nextTargetSet).every((id) => prevTargetSet.has(id));
    if (unchanged) {
      if (affectedUsers.size > 0) {
        await publishWatchUpdates(Array.from(affectedUsers), "history_sync_shares");
      }
      return NextResponse.json({ ok: true });
    }

    if (targetIds.length > 0) {
      const ownRows = await db
        .select({ userId: watchHistory.userId })
        .from(watchHistory)
        .where(
          and(
            eq(watchHistory.projectId, projectId),
            inArray(watchHistory.userId, targetIds),
            eq(watchHistory.mediaType, mediaType),
            eq(watchHistory.tmdbId, tmdbId),
            eq(watchHistory.seasonNumber, season),
            eq(watchHistory.episodeNumber, episode),
            eq(watchHistory.watchedAt, toUtcDate(watchedAt))
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
            inArray(watchHistoryShares.targetUserId, targetIds),
            eq(watchHistory.mediaType, mediaType),
            eq(watchHistory.tmdbId, tmdbId),
            eq(watchHistory.seasonNumber, season),
            eq(watchHistory.episodeNumber, episode),
            eq(watchHistory.watchedAt, toUtcDate(watchedAt)),
            ne(watchHistory.id, watchRecord.id)
          )
        );

      const conflictSet = new Set<string>();
      ownRows.forEach((row) => conflictSet.add(row.userId));
      sharedRows.forEach((row) => conflictSet.add(row.targetUserId));

      if (conflictSet.size > 0) {
        return NextResponse.json(
          {
            code: "FRIEND_HISTORY_EXISTS",
            message: "friend_history_exists",
            conflictFriendIds: Array.from(conflictSet),
          },
          { status: 409 }
        );
      }
    }

    await db
      .delete(watchHistoryShares)
      .where(
        and(
          eq(watchHistoryShares.projectId, projectId),
          eq(watchHistoryShares.ownerId, userId),
          eq(watchHistoryShares.watchHistoryId, watchRecord.id)
        )
      );

    if (targetIds.length > 0) {
      await db.insert(watchHistoryShares).values(
        targetIds.map((targetUserId) => ({
          projectId: projectId,
          ownerId: userId,
          targetUserId,
          watchHistoryId: watchRecord.id,
        }))
      );
      targetIds.forEach((targetId) => affectedUsers.add(targetId));
    }
    if (affectedUsers.size > 0) {
      await publishWatchUpdates(Array.from(affectedUsers), "history_sync_shares");
    }
  } catch (error) {
    console.error("[detail/history-sync-shares] failed", { userId, error });
    return NextResponse.json(
      {
        code: "SYNC_FAILED",
        message: "Sync shares failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
