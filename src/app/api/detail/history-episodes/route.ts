import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchHistory, watchHistoryShares } from "@/server/db/schema";

type Body = {
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
  const tmdbId = body?.tmdbId;
  if (!isPositiveInteger(tmdbId)) {
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
    .select({
      id: watchHistory.id,
      season_number: watchHistory.seasonNumber,
      episode_number: watchHistory.episodeNumber,
    })
    .from(watchHistory)
    .where(
      and(
        eq(watchHistory.userId, session.user.id),
        eq(watchHistory.mediaType, "tv"),
        eq(watchHistory.tmdbId, validatedTmdbId)
      )
    );
  // DetailModal 對影集/動畫的下一集建議，會把自己的紀錄與同步給自己的紀錄視為同等進度；
  // 也就是說 shared history 會一起影響「下一集」與已看集數判斷，這是刻意的產品規則。
  const sharedRows = await db
    .select({
      id: watchHistory.id,
      season_number: watchHistory.seasonNumber,
      episode_number: watchHistory.episodeNumber,
    })
    .from(watchHistoryShares)
    .innerJoin(
      watchHistory,
      eq(watchHistory.id, watchHistoryShares.watchHistoryId)
    )
    .where(
      and(
        eq(watchHistoryShares.targetUserId, session.user.id),
        eq(watchHistory.mediaType, "tv"),
        eq(watchHistory.tmdbId, validatedTmdbId)
      )
    );
  const rowMap = new Map<string, { season_number: number; episode_number: number }>();
  [...ownRows, ...sharedRows].forEach((row) => {
    rowMap.set(row.id, {
      season_number: row.season_number,
      episode_number: row.episode_number,
    });
  });

  return NextResponse.json({ rows: Array.from(rowMap.values()) });
}
