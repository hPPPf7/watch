import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { watchHistory, watchHistoryShares } from "@/server/db/schema";
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
  const season = body?.season ?? 0;
  const episode = body?.episode ?? 0;
  const watchedAt = body?.watchedAt;

  if (
    (mediaType !== "movie" && mediaType !== "tv") ||
    !tmdbId ||
    !watchedAt ||
    !/^\d{4}-\d{2}-\d{2}$/.test(watchedAt)
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

  const historyRows = await db
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
        eq(watchHistory.watchedAt, toUtcDate(watchedAt))
      )
    );
  const historyIds = historyRows.map((row) => row.id);

  const shareRows =
    historyIds.length === 0
      ? []
      : await db
          .select({ targetUserId: watchHistoryShares.targetUserId })
          .from(watchHistoryShares)
          .where(
            and(
              eq(watchHistoryShares.projectId, "watch"),
              inArray(watchHistoryShares.watchHistoryId, historyIds)
            )
          );

  if (historyIds.length > 0) {
    await db
      .delete(watchHistoryShares)
      .where(
        and(
          eq(watchHistoryShares.projectId, "watch"),
          inArray(watchHistoryShares.watchHistoryId, historyIds)
        )
      );
  }

  await db
    .delete(watchHistory)
    .where(
      and(
        eq(watchHistory.userId, userId),
        eq(watchHistory.projectId, "watch"),
        eq(watchHistory.mediaType, mediaType),
        eq(watchHistory.tmdbId, tmdbId),
        eq(watchHistory.seasonNumber, season),
        eq(watchHistory.episodeNumber, episode),
        eq(watchHistory.watchedAt, toUtcDate(watchedAt))
      )
    );

  const affectedUsers = Array.from(
    new Set([userId, ...shareRows.map((row) => row.targetUserId)])
  );
  await publishScopedWatchUpdates(
    await resolveWatchlistScopedTargets({
      userIds: affectedUsers,
      mediaType,
      tmdbId,
    }),
    "history_delete"
  );

  return NextResponse.json({ ok: true });
}
