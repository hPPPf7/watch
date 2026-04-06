import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { and, eq, inArray, ne } from "drizzle-orm";
import { getDb, runInTransaction } from "@/server/db/client";
import { friends, watchHistory, watchHistoryShares } from "@/server/db/schema";
import { isUtcMidnightDate, isValidDateOnly, toUtcDateOnly } from "@/lib/dateOnly";
import { isUuidString } from "@/lib/uuid";
import { publishWatchUpdatesWithScopeFallback } from "@/server/realtime/safePublish";
import { lockSharedHistoryTargets } from "@/server/services/historyShareLock";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  season?: number;
  episode?: number;
  watchedAt?: string;
  originalDate?: string | null;
  friendIds?: string[];
};

type SuccessResult = {
  ok: true;
  duplicate: boolean;
  affectedUsers: string[];
};

type ErrorResult = {
  ok: false;
  status: number;
  body: Record<string, unknown>;
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isWatchHistoryUniqueConflict(error: unknown) {
  if (!(error instanceof Error)) return false;
  const pgError = error as Error & { code?: string; constraint?: string };
  return (
    pgError.code === "23505" &&
    pgError.constraint === "watch_history_unique_key"
  );
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
  const season = body?.season ?? 0;
  const episode = body?.episode ?? 0;
  const watchedAt = body?.watchedAt;
  const originalDate = body?.originalDate ?? null;
  const friendIds = Array.isArray(body?.friendIds) ? body.friendIds : null;
  const hasInvalidOriginalDate =
    originalDate !== null &&
    originalDate !== undefined &&
    (typeof originalDate !== "string" || !isValidDateOnly(originalDate));
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
    hasInvalidOriginalDate ||
    (friendIds !== null &&
      friendIds.some((id) => typeof id !== "string" || !isUuidString(id)))
  ) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
    );
  }

  const validatedTmdbId = tmdbId;
  const validatedSeason = season;
  const validatedEpisode = episode;

  try {
    getDb();
  } catch {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "DATABASE_URL is required" },
      { status: 500 }
    );
  }

  const targetDate = toUtcDateOnly(watchedAt);
  if (!isUtcMidnightDate(targetDate)) {
    console.error("[detail/history-upsert] target date is not UTC midnight", {
      userId,
      watchedAt,
      targetDate: targetDate.toISOString(),
    });
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
    );
  }
  const currentRecordDateValue =
    typeof originalDate === "string" && isValidDateOnly(originalDate)
      ? originalDate
      : null;
  const originalDateValue =
    typeof originalDate === "string" &&
    originalDate !== watchedAt &&
    isValidDateOnly(originalDate)
      ? originalDate
      : null;

  let result: SuccessResult | ErrorResult;
  try {
    result = await runInTransaction<SuccessResult | ErrorResult>(async (tx) => {
      let didChange = false;
      const currentRecord = currentRecordDateValue
        ? await tx
            .select({ id: watchHistory.id })
            .from(watchHistory)
            .where(
              and(
                eq(watchHistory.userId, userId),
                eq(watchHistory.mediaType, mediaType),
                eq(watchHistory.tmdbId, validatedTmdbId),
                eq(watchHistory.seasonNumber, validatedSeason),
                eq(watchHistory.episodeNumber, validatedEpisode),
                eq(watchHistory.watchedAt, toUtcDateOnly(currentRecordDateValue))
              )
            )
            .limit(1)
        : [];
      const currentRecordId = currentRecord[0]?.id ?? null;

      const existing = await tx
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

      const allowedFriendIds =
        friendIds && friendIds.length > 0
          ? Array.from(
              new Set(
                (
                  await tx
                    .select({ friendId: friends.friendId })
                    .from(friends)
                    .where(
                      and(
                        eq(friends.userId, userId),
                        inArray(friends.friendId, friendIds)
                      )
                    )
                ).map((row) => row.friendId)
              )
            )
          : [];

      if (allowedFriendIds.length > 0) {
      await lockSharedHistoryTargets(tx, {
        targetUserIds: allowedFriendIds,
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
            inArray(watchHistory.userId, allowedFriendIds),
            eq(watchHistory.mediaType, mediaType),
            eq(watchHistory.tmdbId, validatedTmdbId),
            eq(watchHistory.seasonNumber, validatedSeason),
            eq(watchHistory.episodeNumber, validatedEpisode),
            eq(watchHistory.watchedAt, targetDate)
          )
        );

      const sharedRows = currentRecordId
        ? await tx
            .select({ targetUserId: watchHistoryShares.targetUserId })
            .from(watchHistoryShares)
            .innerJoin(
              watchHistory,
              eq(watchHistory.id, watchHistoryShares.watchHistoryId)
            )
            .where(
              and(
                inArray(watchHistoryShares.targetUserId, allowedFriendIds),
                eq(watchHistory.mediaType, mediaType),
                eq(watchHistory.tmdbId, validatedTmdbId),
                eq(watchHistory.seasonNumber, validatedSeason),
                eq(watchHistory.episodeNumber, validatedEpisode),
                eq(watchHistory.watchedAt, targetDate),
                ne(watchHistory.id, currentRecordId)
              )
            )
        : await tx
            .select({ targetUserId: watchHistoryShares.targetUserId })
            .from(watchHistoryShares)
            .innerJoin(
              watchHistory,
              eq(watchHistory.id, watchHistoryShares.watchHistoryId)
            )
            .where(
              and(
                inArray(watchHistoryShares.targetUserId, allowedFriendIds),
                eq(watchHistory.mediaType, mediaType),
                eq(watchHistory.tmdbId, validatedTmdbId),
                eq(watchHistory.seasonNumber, validatedSeason),
                eq(watchHistory.episodeNumber, validatedEpisode),
                eq(watchHistory.watchedAt, targetDate)
              )
            );

      const conflictSet = new Set<string>();
      ownRows.forEach((row) => conflictSet.add(row.userId));
      sharedRows.forEach((row) => conflictSet.add(row.targetUserId));
      if (conflictSet.size > 0) {
        return {
          ok: false,
          status: 409,
          body: {
            code: "FRIEND_HISTORY_EXISTS",
            message: "friend_history_exists",
            conflictFriendIds: Array.from(conflictSet),
          },
        };
      }
      }

      const isDuplicate =
        existing.length > 0 &&
        (!currentRecordId || existing[0].id !== currentRecordId);
      let historyId = existing[0]?.id ?? null;
      let existingShareRows: Array<{ targetUserId: string }> = [];

      if (originalDateValue) {
      // 編輯既有觀看紀錄時，若目標日期已經存在同一天同作品／同季同集的紀錄，
      // 這裡刻意直接擋下，不把舊紀錄自動合併到既有 row。
      // 原因是使用者可能只是記錯日期；若直接合併，會把原本屬於不同觀看脈絡
      // 的分享名單、參與好友一起揉成同一筆資料，反而更容易讓資料失真。
      // 因此產品規則是：撞到既有紀錄就回 duplicate，讓使用者自行回去確認
      // 並編輯真正應該保留的那一筆，而不是由後端替他猜測如何合併。
      if (isDuplicate) {
        return { ok: true, duplicate: true, affectedUsers: [] };
      }

      if (currentRecord.length > 0) {
        historyId = currentRecord[0].id;
        didChange = true;
        await tx
          .update(watchHistory)
          .set({ watchedAt: targetDate })
          .where(eq(watchHistory.id, currentRecord[0].id));
      } else {
        const inserted = await tx
          .insert(watchHistory)
          .values({
            userId,
            mediaType,
            tmdbId: validatedTmdbId,
            seasonNumber: validatedSeason,
            episodeNumber: validatedEpisode,
            watchedAt: targetDate,
          })
          .onConflictDoNothing({
            target: [
              watchHistory.userId,
              watchHistory.mediaType,
              watchHistory.tmdbId,
              watchHistory.seasonNumber,
              watchHistory.episodeNumber,
              watchHistory.watchedAt,
            ],
          })
          .returning({ id: watchHistory.id });
        historyId =
          inserted[0]?.id ??
          (
            await tx
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
              .limit(1)
          )[0]?.id ?? null;
        didChange = inserted.length > 0;
      }
      } else if (existing.length === 0) {
      const inserted = await tx
        .insert(watchHistory)
        .values({
          userId,
          mediaType,
          tmdbId: validatedTmdbId,
          seasonNumber: validatedSeason,
          episodeNumber: validatedEpisode,
          watchedAt: targetDate,
        })
        .onConflictDoNothing({
          target: [
            watchHistory.userId,
            watchHistory.mediaType,
            watchHistory.tmdbId,
            watchHistory.seasonNumber,
            watchHistory.episodeNumber,
            watchHistory.watchedAt,
          ],
        })
        .returning({ id: watchHistory.id });
      historyId =
        inserted[0]?.id ??
        (
          await tx
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
            .limit(1)
        )[0]?.id ?? null;
      didChange = inserted.length > 0;
      } else if (isDuplicate) {
        return { ok: true, duplicate: true, affectedUsers: [] };
      }

      if (historyId) {
      existingShareRows = await tx
        .select({ targetUserId: watchHistoryShares.targetUserId })
        .from(watchHistoryShares)
        .where(
          and(
            eq(watchHistoryShares.ownerId, userId),
            eq(watchHistoryShares.watchHistoryId, historyId)
          )
        );
      }

      if (historyId && friendIds !== null) {
      const nextTargetSet = new Set(allowedFriendIds);
      const prevTargetSet = new Set(existingShareRows.map((row) => row.targetUserId));
      const sharesUnchanged =
        nextTargetSet.size === prevTargetSet.size &&
        Array.from(nextTargetSet).every((id) => prevTargetSet.has(id));

      if (!sharesUnchanged) {
        await tx
          .delete(watchHistoryShares)
          .where(
            and(
              eq(watchHistoryShares.ownerId, userId),
              eq(watchHistoryShares.watchHistoryId, historyId)
            )
          );

        if (allowedFriendIds.length > 0) {
          await tx
            .insert(watchHistoryShares)
            .values(
              allowedFriendIds.map((targetUserId) => ({
                ownerId: userId,
                targetUserId,
                watchHistoryId: historyId!,
              }))
            )
            .onConflictDoNothing({
              target: [
                watchHistoryShares.ownerId,
                watchHistoryShares.targetUserId,
                watchHistoryShares.watchHistoryId,
              ],
            });
        }
        didChange = true;
      }
      }

      const affectedUsers = didChange
        ? Array.from(
            new Set([
              userId,
              ...existingShareRows.map((row) => row.targetUserId),
              ...(friendIds !== null ? allowedFriendIds : []),
            ])
          )
        : [];

      return { ok: true, duplicate: false, affectedUsers };
    });
  } catch (error) {
    if (isWatchHistoryUniqueConflict(error)) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error("[detail/history-upsert] failed", { userId, error });
    return NextResponse.json(
      {
        code: "UPSERT_FAILED",
        message: "Upsert history failed",
        ...(process.env.NODE_ENV !== "production"
          ? {
              details: error instanceof Error ? error.message : String(error),
            }
          : {}),
      },
      { status: 500 }
    );
  }

  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  if (result.affectedUsers.length > 0) {
    await publishWatchUpdatesWithScopeFallback({
      label: "detail/history-upsert",
      userIds: result.affectedUsers,
      mediaType,
      tmdbId: validatedTmdbId,
      reason: "history_upsert",
    });
  }

  return NextResponse.json({ ok: true, duplicate: result.duplicate });
}
