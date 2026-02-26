import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchHistory } from "@/server/db/schema";

type Body = {
  tmdbId?: number;
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
  const tmdbId = body?.tmdbId;
  if (!tmdbId) {
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
      season_number: watchHistory.seasonNumber,
      episode_number: watchHistory.episodeNumber,
    })
    .from(watchHistory)
    .where(
      and(
        eq(watchHistory.userId, session.user.id),
        eq(watchHistory.projectId, "watch"),
        eq(watchHistory.mediaType, "tv"),
        eq(watchHistory.tmdbId, tmdbId)
      )
    );

  return NextResponse.json({ rows });
}
