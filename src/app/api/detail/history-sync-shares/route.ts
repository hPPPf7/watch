import { NextResponse } from "next/server";
import { and, eq, inArray, ne } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { friends, watchHistory, watchHistoryShares } from "@/server/db/schema";
import { isValidDateOnly, toUtcDateOnly } from "@/lib/dateOnly";
import { isUuidString } from "@/lib/uuid";
import { publishWatchUpdatesWithScopeFallback } from "@/server/realtime/safePublish";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  season?: number;
  episode?: number;
  watchedAt?: string;
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
  const watchedAt = body?.watchedAt;
  const friendIds = Array.isArray(body?.friendIds) ? body!.friendIds : [];
  const season = body?.season ?? 0;
  const episode = body?.episode ?? 0;
  const projectId = "watch";

  if (
    (mediaType !== "movie" && mediaType !== "tv") ||
    !tmdbId ||
    !watchedAt ||
    !isValidDateOnly(watchedAt) ||
    friendIds.some((id) => typeof id !== "string" || !isUuidString(id))
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
    const targetDate = toUtcDateOnly(watchedAt);
    const result = await db.transaction(async (tx) => {
      const recordRows = await tx
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
            eq(watchHistory.watchedAt, targetDate)
          )
        )
        .limit(1);

      const watchRecord = recordRows[0];
      if (!watchRecord) {
        return { ok: true as const, affectedUsers: [] as string[] };
      }

      const existingShareRows = await tx
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
          : await tx
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
      const targetIds = Array.from(
        new Set(friendIds.filter((id) => validFriendIds.has(id)))
      );
      const nextTargetSet = new Set(targetIds);
      const prevTargetSet = new Set(existingShareRows.map((row) => row.targetUserId));
      const unchanged =
        nextTargetSet.size === prevTargetSet.size &&
        Array.from(nextTargetSet).every((id) => prevTargetSet.has(id));
      if (unchanged) {
        return { ok: true as const, affectedUsers: Array.from(affectedUsers) };
      }

      affectedUsers.add(userId);

      if (targetIds.length > 0) {
        const ownRows = await tx
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
              eq(watchHistory.watchedAt, targetDate)
            )
          );

        const sharedRows = await tx
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
              eq(watchHistory.watchedAt, targetDate),
              ne(watchHistory.id, watchRecord.id)
            )
          );

        const conflictSet = new Set<string>();
        ownRows.forEach((row) => conflictSet.add(row.userId));
        sharedRows.forEach((row) => conflictSet.add(row.targetUserId));

        if (conflictSet.size > 0) {
          return {
            ok: false as const,
            status: 409,
            body: {
              code: "FRIEND_HISTORY_EXISTS",
              message: "friend_history_exists",
              conflictFriendIds: Array.from(conflictSet),
            },
          };
        }
      }

      await tx
        .delete(watchHistoryShares)
        .where(
          and(
            eq(watchHistoryShares.projectId, projectId),
            eq(watchHistoryShares.ownerId, userId),
            eq(watchHistoryShares.watchHistoryId, watchRecord.id)
          )
        );

      if (targetIds.length > 0) {
        await tx
          .insert(watchHistoryShares)
          .values(
            targetIds.map((targetUserId) => ({
              projectId,
              ownerId: userId,
              targetUserId,
              watchHistoryId: watchRecord.id,
            }))
          )
          .onConflictDoNothing({
            target: [
              watchHistoryShares.projectId,
              watchHistoryShares.ownerId,
              watchHistoryShares.targetUserId,
              watchHistoryShares.watchHistoryId,
            ],
          });
        targetIds.forEach((targetId) => affectedUsers.add(targetId));
      }

      return { ok: true as const, affectedUsers: Array.from(affectedUsers) };
    });

    if (!result.ok) {
      return NextResponse.json(result.body, { status: result.status });
    }

    if (result.affectedUsers.length > 0) {
      await publishWatchUpdatesWithScopeFallback({
        label: "detail/history-sync-shares",
        userIds: result.affectedUsers,
        mediaType,
        tmdbId,
        reason: "history_sync_shares",
      });
    }
  } catch (error) {
    console.error("[detail/history-sync-shares] failed", { userId, error });
    return NextResponse.json(
      {
        code: "SYNC_FAILED",
        message: "Sync shares failed",
        ...(process.env.NODE_ENV !== "production"
          ? {
              details: error instanceof Error ? error.message : String(error),
            }
          : {}),
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
