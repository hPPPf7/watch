import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, runInTransaction } from "@/server/db/client";
import { watchHistory, watchHistoryShares } from "@/server/db/schema";
import { isValidDateOnly, toUtcDateOnly } from "@/lib/dateOnly";
import { publishWatchUpdatesWithScopeFallback } from "@/server/realtime/safePublish";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  season?: number;
  episode?: number;
  watchedAt?: string;
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
  const season = body?.season ?? 0;
  const episode = body?.episode ?? 0;
  const watchedAt = body?.watchedAt;

  if (
    (mediaType !== "movie" && mediaType !== "tv") ||
    !isPositiveInteger(tmdbId) ||
    !isNonNegativeInteger(season) ||
    !isNonNegativeInteger(episode) ||
    !watchedAt ||
    !isValidDateOnly(watchedAt)
  ) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
    );
  }

  const validatedTmdbId = tmdbId;
  const validatedSeason = season;
  const validatedEpisode = episode;
  const validatedWatchedAt = watchedAt;

  try {
    getDb();
  } catch {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "DATABASE_URL is required" },
      { status: 500 }
    );
  }

  const affectedUsers = await runInTransaction(async (tx) => {
    const historyRows = await tx
      .select({ id: watchHistory.id })
      .from(watchHistory)
      .where(
        and(
          eq(watchHistory.userId, userId),
          eq(watchHistory.projectId, "watch"),
          eq(watchHistory.mediaType, mediaType),
          eq(watchHistory.tmdbId, validatedTmdbId),
          eq(watchHistory.seasonNumber, validatedSeason),
          eq(watchHistory.episodeNumber, validatedEpisode),
          eq(watchHistory.watchedAt, toUtcDateOnly(validatedWatchedAt))
        )
      );
    const historyIds = historyRows.map((row) => row.id);
    if (historyIds.length === 0) {
      return [];
    }

    const shareRows =
      await tx
        .select({ targetUserId: watchHistoryShares.targetUserId })
        .from(watchHistoryShares)
        .where(
          and(
            eq(watchHistoryShares.projectId, "watch"),
            inArray(watchHistoryShares.watchHistoryId, historyIds)
          )
        );

    if (historyIds.length > 0) {
      await tx
        .delete(watchHistoryShares)
        .where(
          and(
            eq(watchHistoryShares.projectId, "watch"),
            inArray(watchHistoryShares.watchHistoryId, historyIds)
          )
        );
    }

    await tx
      .delete(watchHistory)
      .where(
        and(
          eq(watchHistory.userId, userId),
          eq(watchHistory.projectId, "watch"),
          eq(watchHistory.mediaType, mediaType),
          eq(watchHistory.tmdbId, validatedTmdbId),
          eq(watchHistory.seasonNumber, validatedSeason),
          eq(watchHistory.episodeNumber, validatedEpisode),
          eq(watchHistory.watchedAt, toUtcDateOnly(validatedWatchedAt))
        )
      );

    return Array.from(
      new Set([userId, ...shareRows.map((row) => row.targetUserId)])
    );
  });

  await publishWatchUpdatesWithScopeFallback({
    label: "detail/history-delete",
    userIds: affectedUsers,
    mediaType,
    tmdbId: validatedTmdbId,
    reason: "history_delete",
  });

  return NextResponse.json({ ok: true });
}
