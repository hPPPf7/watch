import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchlistItems } from "@/server/db/schema";
import { publishScopedWatchUpdates } from "@/server/realtime/watchUpdates";

const PROJECT_ID = "watch";

type Body = {
  item?: {
    type: "movie" | "tv";
    id: number;
    title: string;
    year: string | null;
    releaseDate: string | null;
    posterPath: string | null;
    isAnime: boolean;
  };
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

  const body = (await request.json().catch(() => null)) as Body | null;
  const item = body?.item;
  if (!item || (item.type !== "movie" && item.type !== "tv")) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
    );
  }

  const existing = await db
    .select({ id: watchlistItems.id, isAnime: watchlistItems.isAnime })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, userId),
        eq(watchlistItems.projectId, PROJECT_ID),
        eq(watchlistItems.mediaType, item.type),
        eq(watchlistItems.tmdbId, item.id)
      )
    )
    ;

  if (existing.length > 0) {
    const nextIsAnime = item.isAnime ? 1 : 0;
    const previousScopes = Array.from(
      new Set(existing.map((row) => row.isAnime))
    ).map((isAnimeFlag) => ({
      mediaType: item.type,
      isAnime: item.type === "tv" ? isAnimeFlag === 1 : false,
    }));
    const keepRow =
      existing.find((row) => row.isAnime === nextIsAnime) ?? existing[0];
    const duplicateIds = existing
      .filter((row) => row.id !== keepRow.id)
      .map((row) => row.id);
    const needsUpdate = keepRow.isAnime !== nextIsAnime;

    if (needsUpdate) {
      await db
        .update(watchlistItems)
        .set({ isAnime: nextIsAnime })
        .where(eq(watchlistItems.id, keepRow.id));
    }

    if (duplicateIds.length > 0) {
      await db
        .delete(watchlistItems)
        .where(inArray(watchlistItems.id, duplicateIds));
    }

    if (needsUpdate || duplicateIds.length > 0) {
      await publishScopedWatchUpdates(
        [
          {
            userId,
            revisionScopes: [
              ...previousScopes,
              {
                mediaType: item.type,
                isAnime: item.type === "tv" ? item.isAnime : false,
              },
            ],
          },
        ],
        "home_watchlist_sync",
      );
    }
  }

  return NextResponse.json({ ok: true });
}
