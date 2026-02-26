import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchHistory } from "@/server/db/schema";

type Body = {
  tmdbIds?: number[];
};

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
    return NextResponse.json({ rows: [] });
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

  const records = await db
    .select({
      tmdb_id: watchHistory.tmdbId,
      watched_at: watchHistory.watchedAt,
    })
    .from(watchHistory)
    .where(
      and(
        eq(watchHistory.userId, userId),
        eq(watchHistory.projectId, "watch"),
        eq(watchHistory.mediaType, "movie"),
        inArray(watchHistory.tmdbId, tmdbIds)
      )
    )
    .orderBy(desc(watchHistory.watchedAt));

  const countMap: Record<number, number> = {};
  const latestMap: Record<number, string> = {};
  records.forEach((row) => {
    const tmdbId = row.tmdb_id;
    countMap[tmdbId] = (countMap[tmdbId] ?? 0) + 1;
    if (!latestMap[tmdbId]) {
      latestMap[tmdbId] =
        row.watched_at instanceof Date
          ? row.watched_at.toISOString().slice(0, 10)
          : String(row.watched_at).slice(0, 10);
    }
  });

  const rows = tmdbIds
    .filter((tmdbId) => Boolean(latestMap[tmdbId]))
    .map((tmdbId) => ({
      tmdb_id: tmdbId,
      watched_at: latestMap[tmdbId] ?? null,
      owner_id: userId,
      watch_count: countMap[tmdbId] ?? 0,
      friend_id: null as string | null,
      friend_nickname: null as string | null,
      is_owner: true,
    }));

  return NextResponse.json({ rows });
}

