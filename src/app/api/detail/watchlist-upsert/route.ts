import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchlistItems } from "@/server/db/schema";
import { publishScopedWatchUpdates } from "@/server/realtime/watchUpdates";

type Body = {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  isAnime?: boolean;
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
  const mediaType = body?.mediaType;
  const tmdbId = body?.tmdbId;
  const isAnime = body?.isAnime ?? false;

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

  const existing = await db
    .select({ id: watchlistItems.id })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, userId),
        eq(watchlistItems.projectId, "watch"),
        eq(watchlistItems.mediaType, mediaType),
        eq(watchlistItems.tmdbId, tmdbId)
      )
    )
    .limit(1);

  if (existing.length === 0) {
    await db.insert(watchlistItems).values({
      userId,
      projectId: "watch",
      mediaType,
      tmdbId,
      isAnime: isAnime ? 1 : 0,
    });
    await publishScopedWatchUpdates(
      [
        {
          userId,
          revisionScopes: [
            { mediaType, isAnime: mediaType === "tv" ? isAnime : false },
          ],
        },
      ],
      "watchlist_upsert",
    );
  }

  return NextResponse.json({ ok: true, duplicate: existing.length > 0 });
}
