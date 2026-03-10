import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { and, eq, inArray, ne } from "drizzle-orm";
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

  if (
    (mediaType !== "movie" && mediaType !== "tv") ||
    !tmdbId ||
    !watchedAt ||
    !isValidDateOnly(watchedAt) ||
    (friendIds !== null &&
      friendIds.some((id) => typeof id !== "string" || !isUuidString(id)))
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

  const targetDate = toUtcDateOnly(watchedAt);
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
    result = await db.transaction<SuccessResult | ErrorResult>(async (tx) => {
      let didChange = false;
      const currentRecord = currentRecordDateValue
        ? await tx
            .select({ id: watchHistory.id })
            .from(watchHistory)
            .where(
              and(
                eq(watchHistory.userId, userId),
                eq(watchHistory.projectId, "watch"),
                eq(watchHistory.mediaType, mediaType),
                eq(watchHistory.tmdbId, tmdbId),
                eq(watchHistory.seasonNumber, season),
                eq(watchHistory.episodeNumber, episode),
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
            eq(watchHistory.projectId, "watch"),
            eq(watchHistory.mediaType, mediaType),
            eq(watchHistory.tmdbId, tmdbId),
            eq(watchHistory.seasonNumber, season),
            eq(watchHistory.episodeNumber, episode),
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
                        eq(friends.projectId, "watch"),
                        eq(friends.userId, userId),
                        inArray(friends.friendId, friendIds)
                      )
                    )
                ).map((row) => row.friendId)
              )
            )
          : [];

      if (allowedFriendIds.length > 0) {
      const ownRows = await tx
        .select({ userId: watchHistory.userId })
        .from(watchHistory)
        .where(
          and(
            eq(watchHistory.projectId, "watch"),
            inArray(watchHistory.userId, allowedFriendIds),
            eq(watchHistory.mediaType, mediaType),
            eq(watchHistory.tmdbId, tmdbId),
            eq(watchHistory.seasonNumber, season),
            eq(watchHistory.episodeNumber, episode),
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
                eq(watchHistoryShares.projectId, "watch"),
                inArray(watchHistoryShares.targetUserId, allowedFriendIds),
                eq(watchHistory.mediaType, mediaType),
                eq(watchHistory.tmdbId, tmdbId),
                eq(watchHistory.seasonNumber, season),
                eq(watchHistory.episodeNumber, episode),
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
                eq(watchHistoryShares.projectId, "watch"),
                inArray(watchHistoryShares.targetUserId, allowedFriendIds),
                eq(watchHistory.mediaType, mediaType),
                eq(watchHistory.tmdbId, tmdbId),
                eq(watchHistory.seasonNumber, season),
                eq(watchHistory.episodeNumber, episode),
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
            projectId: "watch",
            mediaType,
            tmdbId,
            seasonNumber: season,
            episodeNumber: episode,
            watchedAt: targetDate,
          })
          .onConflictDoNothing({
            target: [
              watchHistory.projectId,
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
                  eq(watchHistory.projectId, "watch"),
                  eq(watchHistory.mediaType, mediaType),
                  eq(watchHistory.tmdbId, tmdbId),
                  eq(watchHistory.seasonNumber, season),
                  eq(watchHistory.episodeNumber, episode),
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
          projectId: "watch",
          mediaType,
          tmdbId,
          seasonNumber: season,
          episodeNumber: episode,
          watchedAt: targetDate,
        })
        .onConflictDoNothing({
          target: [
            watchHistory.projectId,
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
                eq(watchHistory.projectId, "watch"),
                eq(watchHistory.mediaType, mediaType),
                eq(watchHistory.tmdbId, tmdbId),
                eq(watchHistory.seasonNumber, season),
                eq(watchHistory.episodeNumber, episode),
                eq(watchHistory.watchedAt, targetDate)
              )
            )
            .limit(1)
        )[0]?.id ?? null;
      didChange = inserted.length > 0;
      } else if (isDuplicate) {
        return { ok: true, duplicate: true, affectedUsers: [] };
      }

      if (historyId && friendIds !== null) {
      existingShareRows = await tx
        .select({ targetUserId: watchHistoryShares.targetUserId })
        .from(watchHistoryShares)
        .where(
          and(
            eq(watchHistoryShares.projectId, "watch"),
            eq(watchHistoryShares.ownerId, userId),
            eq(watchHistoryShares.watchHistoryId, historyId)
          )
        );

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
              eq(watchHistoryShares.projectId, "watch"),
              eq(watchHistoryShares.ownerId, userId),
              eq(watchHistoryShares.watchHistoryId, historyId)
            )
          );

        if (allowedFriendIds.length > 0) {
          await tx
            .insert(watchHistoryShares)
            .values(
              allowedFriendIds.map((targetUserId) => ({
                projectId: "watch",
                ownerId: userId,
                targetUserId,
                watchHistoryId: historyId!,
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
        }
        didChange = true;
      }
      }

      const affectedUsers =
        didChange && friendIds !== null
          ? Array.from(
              new Set([
                userId,
                ...existingShareRows.map((row) => row.targetUserId),
                ...allowedFriendIds,
              ])
            )
          : didChange
            ? [userId]
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
        details: error instanceof Error ? error.message : String(error),
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
      tmdbId,
      reason: "history_upsert",
    });
  }

  return NextResponse.json({ ok: true, duplicate: result.duplicate });
}
