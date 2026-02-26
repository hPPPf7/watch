import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchlistItems } from "@/server/db/schema";

const PROJECT_ID = "watch";

type Body = {
  mediaType?: "movie" | "tv";
  isAnime?: boolean;
  ids?: number[];
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
  let db;
  try {
    db = getDb();
  } catch {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "DATABASE_URL is required" },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const mediaType = body.mediaType;
  const isAnime = Boolean(body.isAnime);
  const ids = Array.isArray(body.ids) ? body.ids : [];

  if ((mediaType !== "movie" && mediaType !== "tv") || ids.length === 0) {
    return NextResponse.json({ activeIds: [] as number[] });
  }

  const data = await db
    .select({ tmdb_id: watchlistItems.tmdbId })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, userId),
        eq(watchlistItems.projectId, PROJECT_ID),
        eq(watchlistItems.mediaType, mediaType),
        eq(watchlistItems.isAnime, isAnime ? 1 : 0),
        inArray(watchlistItems.tmdbId, ids)
      )
    );

  return NextResponse.json({
    activeIds: ((data ?? []) as Array<{ tmdb_id: number }>).map((item) => item.tmdb_id),
  });
}
