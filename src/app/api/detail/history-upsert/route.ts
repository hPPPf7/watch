import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { and, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { friends, watchHistory, watchHistoryShares } from "@/server/db/schema";
import {
  publishScopedWatchUpdates,
  resolveWatchlistScopedTargets,
} from "@/server/realtime/watchUpdates";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  season?: number;
  episode?: number;
  watchedAt?: string;
  originalDate?: string | null;
  friendIds?: string[];
};

const toUtcDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

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
  const friendIds = Array.isArray(body?.friendIds) ? body!.friendIds : null;

  if (
    (mediaType !== "movie" && mediaType !== "tv") ||
    !tmdbId ||
    !watchedAt ||
    !isDateOnly(watchedAt) ||
    (friendIds !== null && friendIds.some((id) => typeof id !== "string" || !id))
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
  let didChange = false;
  const targetDate = toUtcDate(watchedAt);
  const currentRecordDateValue =
    typeof originalDate === "string" && isDateOnly(originalDate)
      ? originalDate
      : null;
  const originalDateValue =
    typeof originalDate === "string" &&
    originalDate !== watchedAt &&
    isDateOnly(originalDate)
      ? originalDate
      : null;
  const currentRecord = currentRecordDateValue
    ? await db
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
            eq(watchHistory.watchedAt, toUtcDate(currentRecordDateValue))
          )
        )
        .limit(1)
    : [];
  const currentRecordId = currentRecord[0]?.id ?? null;

  const existing = await db
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
      ? (
          await db
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
      : [];

  if (allowedFriendIds.length > 0) {
    const ownRows = await db
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
      ? await db
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
      : await db
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

  const isDuplicate =
    existing.length > 0 && (!currentRecordId || existing[0].id !== currentRecordId);
  let historyId = existing[0]?.id ?? null;
  let existingShareRows: Array<{ targetUserId: string }> = [];

  if (originalDateValue) {
    if (isDuplicate) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    if (currentRecord.length > 0) {
      historyId = currentRecord[0].id;
      didChange = true;
      await db
        .update(watchHistory)
        .set({ watchedAt: targetDate })
        .where(eq(watchHistory.id, currentRecord[0].id));
    } else {
      const inserted = await db
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
        .returning({ id: watchHistory.id });
      historyId = inserted[0]?.id ?? null;
      didChange = true;
    }
  } else if (existing.length === 0) {
    const inserted = await db
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
      .returning({ id: watchHistory.id });
    historyId = inserted[0]?.id ?? null;
    didChange = true;
  } else if (isDuplicate) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (historyId && friendIds !== null) {
    existingShareRows = await db
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
      await db
        .delete(watchHistoryShares)
        .where(
          and(
            eq(watchHistoryShares.projectId, "watch"),
            eq(watchHistoryShares.ownerId, userId),
            eq(watchHistoryShares.watchHistoryId, historyId)
          )
        );

      if (allowedFriendIds.length > 0) {
        await db.insert(watchHistoryShares).values(
          allowedFriendIds.map((targetUserId) => ({
            projectId: "watch",
            ownerId: userId,
            targetUserId,
            watchHistoryId: historyId,
          }))
        );
      }
      didChange = true;
    }
  }

  if (didChange) {
    const affectedUsers =
      friendIds !== null
        ? Array.from(
            new Set([
              userId,
              ...existingShareRows.map((row) => row.targetUserId),
              ...allowedFriendIds,
            ])
          )
        : [userId];
    await publishScopedWatchUpdates(
      await resolveWatchlistScopedTargets({
        userIds: affectedUsers,
        mediaType,
        tmdbId,
      }),
      "history_upsert"
    );
  }

  return NextResponse.json({ ok: true, duplicate: false });
}
