import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchHistory } from "@/server/db/schema";

type Body = {
  tmdbIds?: number[];
};

type EpisodeRow = {
  tmdbId: number;
  seasonNumber: number | null;
  episodeNumber: number | null;
  watchedAt: Date;
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
  const tmdbIds = Array.isArray(body?.tmdbIds)
    ? body!.tmdbIds.filter((id): id is number => typeof id === "number")
    : [];
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

  const rows = (await db
    .select({
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
    )
    .orderBy(desc(watchHistory.watchedAt))) as EpisodeRow[];

  const latestEpisodes: Record<number, { season: number; episode: number }> = {};
  const watchedCounts: Record<number, number> = {};
  const latestWatchedDates: Record<number, string> = {};
  const topRank: Record<number, number> = {};

  rows.forEach((row) => {
    watchedCounts[row.tmdbId] = (watchedCounts[row.tmdbId] ?? 0) + 1;
    if (!latestWatchedDates[row.tmdbId]) {
      latestWatchedDates[row.tmdbId] = row.watchedAt.toISOString().slice(0, 10);
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
}

