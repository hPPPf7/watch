import { NextResponse } from "next/server";
import { and, eq, inArray, ne } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb, runInTransaction } from "@/server/db/client";
import { friends, watchHistory, watchHistoryShares } from "@/server/db/schema";
import { isValidDateOnly, toUtcDateOnly } from "@/lib/dateOnly";
import { isUuidString } from "@/lib/uuid";
import { publishWatchUpdatesWithScopeFallback } from "@/server/realtime/safePublish";
import { lockSharedHistoryTargets } from "@/server/services/historyShareLock";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  season?: number;
  episode?: number;
  watchedAt?: string;
  friendIds?: string[];
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

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
  const hasInvalidMovieEpisodeScope =
    mediaType === "movie" && (season !== 0 || episode !== 0);

  if (
    (mediaType !== "movie" && mediaType !== "tv") ||
    !isPositiveInteger(tmdbId) ||
    !isNonNegativeInteger(season) ||
    !isNonNegativeInteger(episode) ||
    hasInvalidMovieEpisodeScope ||
    !watchedAt ||
    !isValidDateOnly(watchedAt) ||
    friendIds.some((id) => typeof id !== "string" || !isUuidString(id))
  ) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
    );
  }

  try {
    getDb();
  } catch {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "DATABASE_URL is required" },
      { status: 500 }
    );
  }

  try {
    const targetDate = toUtcDateOnly(watchedAt);
    const validatedTmdbId = tmdbId;
    const validatedSeason = season;
    const validatedEpisode = episode;
    const result = await runInTransaction(async (tx) => {
      const recordRows = await tx
        .select({ id: watchHistory.id })
        .from(watchHistory)
        .where(
          and(
            eq(watchHistory.userId, userId),
            eq(watchHistory.mediaType, mediaType),
            eq(watchHistory.tmdbId, validatedTmdbId),
            eq(watchHistory.seasonNumber, validatedSeason),
            eq(watchHistory.episodeNumber, validatedEpisode),
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
        return { ok: true as const, affectedUsers: [] as string[] };
      }

      affectedUsers.add(userId);

      if (targetIds.length > 0) {
        await lockSharedHistoryTargets(tx, {
          targetUserIds: targetIds,
          mediaType,
          tmdbId: validatedTmdbId,
          seasonNumber: validatedSeason,
          episodeNumber: validatedEpisode,
          watchedAt,
        });
        const ownRows = await tx
          .select({ userId: watchHistory.userId })
          .from(watchHistory)
          .where(
            and(
              inArray(watchHistory.userId, targetIds),
              eq(watchHistory.mediaType, mediaType),
              eq(watchHistory.tmdbId, validatedTmdbId),
              eq(watchHistory.seasonNumber, validatedSeason),
              eq(watchHistory.episodeNumber, validatedEpisode),
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
              inArray(watchHistoryShares.targetUserId, targetIds),
              eq(watchHistory.mediaType, mediaType),
              eq(watchHistory.tmdbId, validatedTmdbId),
              eq(watchHistory.seasonNumber, validatedSeason),
              eq(watchHistory.episodeNumber, validatedEpisode),
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
            eq(watchHistoryShares.ownerId, userId),
            eq(watchHistoryShares.watchHistoryId, watchRecord.id)
          )
        );

      if (targetIds.length > 0) {
        await tx
          .insert(watchHistoryShares)
          .values(
            targetIds.map((targetUserId) => ({
              ownerId: userId,
              targetUserId,
              watchHistoryId: watchRecord.id,
            }))
          )
          .onConflictDoNothing({
            target: [
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
