import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchlistItems } from "@/server/db/schema";

type Body = {
  mediaType?: "movie" | "tv";
  isAnime?: boolean;
  ids?: number[];
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Not signed in" },
      { status: 401 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const mediaType = body.mediaType;
  const isAnime = Boolean(body.isAnime);
  const rawIds = body.ids;
  const ids = Array.isArray(rawIds) ? rawIds : [];

  if ((mediaType !== "movie" && mediaType !== "tv") || ids.length === 0) {
    return NextResponse.json({ activeIds: [] as number[] });
  }

  if (ids.some((id) => !isPositiveInteger(id))) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid ids" },
      { status: 400 },
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

  const data = await db
    .select({ tmdb_id: watchlistItems.tmdbId })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, userId),
        eq(watchlistItems.mediaType, mediaType),
        eq(watchlistItems.isAnime, isAnime ? 1 : 0),
        inArray(watchlistItems.tmdbId, ids)
      )
    );

  return NextResponse.json({
    activeIds: ((data ?? []) as Array<{ tmdb_id: number }>).map((item) => item.tmdb_id),
  });
}
