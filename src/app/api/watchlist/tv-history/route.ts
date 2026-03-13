import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchHistory, watchHistoryShares } from "@/server/db/schema";

type Body = {
  tmdbIds?: number[];
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

type EpisodeRow = {
  id: string;
  tmdbId: number;
  seasonNumber: number | null;
  episodeNumber: number | null;
  watchedAt: Date | string;
};

const episodeRank = (season: number | null, episode: number | null) =>
  (season ?? 0) * 100000 + (episode ?? 0);

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
  const rawTmdbIds = Array.isArray(body?.tmdbIds) ? body!.tmdbIds : [];
  if (rawTmdbIds.some((id) => !isPositiveInteger(id))) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid tmdbIds" },
      { status: 400 },
    );
  }
  const tmdbIds = rawTmdbIds as number[];
  if (tmdbIds.length === 0) {
    return NextResponse.json({
      latestEpisodes: {},
      watchedCounts: {},
      latestWatchedDates: {},
    });
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
    const ownRows = (await db
      .select({
        id: watchHistory.id,
        tmdbId: watchHistory.tmdbId,
        seasonNumber: watchHistory.seasonNumber,
        episodeNumber: watchHistory.episodeNumber,
        watchedAt: watchHistory.watchedAt,
      })
      .from(watchHistory)
      .where(
        and(
          eq(watchHistory.userId, userId),
          eq(watchHistory.projectId, "watch"),
          eq(watchHistory.mediaType, "tv"),
          inArray(watchHistory.tmdbId, tmdbIds)
        )
      )) as EpisodeRow[];

    const sharedRows = (await db
      .select({
        id: watchHistory.id,
        tmdbId: watchHistory.tmdbId,
        seasonNumber: watchHistory.seasonNumber,
        episodeNumber: watchHistory.episodeNumber,
        watchedAt: watchHistory.watchedAt,
      })
      .from(watchHistoryShares)
      .innerJoin(
        watchHistory,
        eq(watchHistory.id, watchHistoryShares.watchHistoryId)
      )
      .where(
        and(
          eq(watchHistoryShares.projectId, "watch"),
          eq(watchHistoryShares.targetUserId, userId),
          eq(watchHistory.projectId, "watch"),
          eq(watchHistory.mediaType, "tv"),
          inArray(watchHistory.tmdbId, tmdbIds)
        )
      )) as EpisodeRow[];

    const rowMap = new Map<string, EpisodeRow>();
    [...ownRows, ...sharedRows].forEach((row) => rowMap.set(row.id, row));
    const rows = Array.from(rowMap.values());

    const latestEpisodes: Record<number, { season: number; episode: number }> = {};
    const watchedCounts: Record<number, number> = {};
    const latestWatchedDates: Record<number, string> = {};
    const topRank: Record<number, number> = {};
    const latestTimestamp: Record<number, number> = {};

    rows.forEach((row) => {
      watchedCounts[row.tmdbId] = (watchedCounts[row.tmdbId] ?? 0) + 1;
      const watchedAtDate =
        row.watchedAt instanceof Date ? row.watchedAt : new Date(row.watchedAt);
      const watchedAtIso = watchedAtDate.toISOString().slice(0, 10);
      const watchedAtTs = watchedAtDate.getTime();
      if (
        latestTimestamp[row.tmdbId] === undefined ||
        watchedAtTs > latestTimestamp[row.tmdbId]
      ) {
        latestTimestamp[row.tmdbId] = watchedAtTs;
        latestWatchedDates[row.tmdbId] = watchedAtIso;
      }
      const rank = episodeRank(row.seasonNumber, row.episodeNumber);
      if (rank <= 0) return;
      if (topRank[row.tmdbId] === undefined || rank > topRank[row.tmdbId]) {
        topRank[row.tmdbId] = rank;
        latestEpisodes[row.tmdbId] = {
          season: row.seasonNumber ?? 0,
          episode: row.episodeNumber ?? 0,
        };
      }
    });

    return NextResponse.json({ latestEpisodes, watchedCounts, latestWatchedDates });
  } catch (error) {
    console.error("[watchlist/tv-history] failed", { userId, error });
    const details =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : JSON.stringify(error);
    return NextResponse.json(
      {
        code: "HISTORY_FETCH_FAILED",
        message: "Fetch history failed",
        ...(process.env.NODE_ENV !== "production" ? { details } : {}),
      },
      { status: 500 },
    );
  }
}
