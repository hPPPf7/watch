import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchlistItems } from "@/server/db/schema";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  isAnime?: boolean;
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
  const isAnime = body?.isAnime === true;

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

  const row = await db
    .select({ id: watchlistItems.id })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, session.user.id),
        eq(watchlistItems.mediaType, mediaType),
        eq(watchlistItems.tmdbId, validatedTmdbId),
        mediaType === "tv"
          ? eq(watchlistItems.isAnime, isAnime ? 1 : 0)
          : eq(watchlistItems.isAnime, 0)
      )
    )
    .limit(1);

  return NextResponse.json({ inWatchlist: row.length > 0 });
}
