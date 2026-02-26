import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { watchHistory } from "@/server/db/schema";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  season?: number;
  episode?: number;
};

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
  const season = body?.season ?? 0;
  const episode = body?.episode ?? 0;

  if ((mediaType !== "movie" && mediaType !== "tv") || !tmdbId) {
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

  const rows = await db
    .select({
      watchedAt: watchHistory.watchedAt,
      ownerId: watchHistory.userId,
    })
    .from(watchHistory)
    .where(
      and(
        eq(watchHistory.userId, session.user.id),
        eq(watchHistory.projectId, "watch"),
        eq(watchHistory.mediaType, mediaType),
        eq(watchHistory.tmdbId, tmdbId),
        eq(watchHistory.seasonNumber, season),
        eq(watchHistory.episodeNumber, episode)
      )
    )
    .orderBy(watchHistory.watchedAt);

  const normalized = rows
    .map((row) => {
      const value = row.watchedAt as unknown;
      const watchedAt =
        value instanceof Date
          ? value.toISOString().slice(0, 10)
          : String(value).slice(0, 10);
      return {
        watched_at: watchedAt,
        owner_id: row.ownerId,
        friend_id: null,
        friend_nickname: null,
        is_owner: false,
      };
    })
    .sort((a, b) => b.watched_at.localeCompare(a.watched_at));

  return NextResponse.json({ rows: normalized });
}
