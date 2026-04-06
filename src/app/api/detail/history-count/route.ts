import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchHistory, watchHistoryShares } from "@/server/db/schema";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Not signed in" },
      { status: 401 }
    );
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const mediaType = body?.mediaType;
  const tmdbId = body?.tmdbId;
  if ((mediaType !== "movie" && mediaType !== "tv") || !isPositiveInteger(tmdbId)) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
    );
  }
  const validatedTmdbId = tmdbId;

  let db;
  try {
    db = getDb();
  } catch {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "DATABASE_URL is required" },
      { status: 500 }
    );
  }

  const ownRows = await db
    .select({ id: watchHistory.id })
    .from(watchHistory)
    .where(
      and(
        eq(watchHistory.userId, session.user.id),
        eq(watchHistory.mediaType, mediaType),
        eq(watchHistory.tmdbId, validatedTmdbId)
      )
    );
  const ownEpisodeRows =
    mediaType === "movie"
      ? []
      : await db
          .select({
            seasonNumber: watchHistory.seasonNumber,
            episodeNumber: watchHistory.episodeNumber,
          })
          .from(watchHistory)
          .where(
            and(
              eq(watchHistory.userId, session.user.id),
              eq(watchHistory.mediaType, mediaType),
              eq(watchHistory.tmdbId, validatedTmdbId)
            )
          );
  // DetailModal 對影集/動畫的進度定義是「自己的紀錄 + 同步給自己的紀錄都算同一份進度」，
  // 所以這裡刻意把 shared history 一起算進已看 X / Y。
  const sharedRows = await db
    .select({
      id: watchHistory.id,
      seasonNumber: watchHistory.seasonNumber,
      episodeNumber: watchHistory.episodeNumber,
    })
    .from(watchHistoryShares)
    .innerJoin(
      watchHistory,
      eq(watchHistory.id, watchHistoryShares.watchHistoryId)
    )
    .where(
      and(
        eq(watchHistoryShares.targetUserId, session.user.id),
        eq(watchHistory.mediaType, mediaType),
        eq(watchHistory.tmdbId, validatedTmdbId)
      )
    );
  const ownEpisodeKeys =
    mediaType === "movie"
      ? ownRows.map((row) => row.id)
      : ownEpisodeRows.map(
          (row) => `${row.seasonNumber ?? 0}:${row.episodeNumber ?? 0}`,
        );
  const sharedEpisodeKeys =
    mediaType === "movie"
      ? sharedRows.map((row) => row.id)
      : sharedRows.map(
          (row) => `${row.seasonNumber ?? 0}:${row.episodeNumber ?? 0}`,
        );
  const count = new Set([
    ...ownEpisodeKeys,
    ...sharedEpisodeKeys,
  ]).size;

  return NextResponse.json({ count });
}
