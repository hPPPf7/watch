import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchlistItems } from "@/server/db/schema";

export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Not signed in" },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const mediaType = url.searchParams.get("mediaType");
  const isAnime = url.searchParams.get("isAnime") === "true";
  if (mediaType !== "movie" && mediaType !== "tv") {
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

  const rows = await db
    .select({
      id: watchlistItems.id,
      tmdb_id: watchlistItems.tmdbId,
      media_type: watchlistItems.mediaType,
      is_anime: watchlistItems.isAnime,
      created_at: watchlistItems.createdAt,
    })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, userId),
        eq(watchlistItems.projectId, "watch"),
        eq(watchlistItems.mediaType, mediaType),
        mediaType === "tv"
          ? eq(watchlistItems.isAnime, isAnime ? 1 : 0)
          : eq(watchlistItems.isAnime, 0)
      )
    )
    .orderBy(desc(watchlistItems.createdAt));

  const normalized = rows.map((row) => ({
    id: row.id,
    tmdb_id: row.tmdb_id,
    title: `TMDB ${row.tmdb_id}`,
    year: null as string | null,
    release_date: null as string | null,
    tmdb_cached_at: null as string | null,
    poster_path: null as string | null,
    media_type: row.media_type,
    is_anime: Boolean(row.is_anime),
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  }));

  return NextResponse.json({ rows: normalized });
}
