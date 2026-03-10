import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchlistItems } from "@/server/db/schema";
import { publishScopedWatchUpdates } from "@/server/realtime/watchUpdates";
import { runBestEffortPublish } from "@/server/realtime/safePublish";

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

  if ((mediaType !== "movie" && mediaType !== "tv") || !isPositiveInteger(tmdbId)) {
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
    .select({ id: watchlistItems.id, isAnime: watchlistItems.isAnime })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, userId),
        eq(watchlistItems.projectId, "watch"),
        eq(watchlistItems.mediaType, mediaType),
        eq(watchlistItems.tmdbId, tmdbId)
      )
    );

  if (existing.length === 0) {
    const inserted = await db
      .insert(watchlistItems)
      .values({
        userId,
        projectId: "watch",
        mediaType,
        tmdbId,
        isAnime: isAnime ? 1 : 0,
      })
      .onConflictDoNothing({
        target: [
          watchlistItems.userId,
          watchlistItems.projectId,
          watchlistItems.mediaType,
          watchlistItems.tmdbId,
          watchlistItems.isAnime,
        ],
      })
      .returning({ id: watchlistItems.id });
    if (inserted.length > 0) {
      await runBestEffortPublish("detail/watchlist-upsert:add", async () => {
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
      });
    }
  } else if (mediaType === "tv") {
    const nextIsAnime = isAnime ? 1 : 0;
    const previousScopes = Array.from(
      new Set(existing.map((row) => row.isAnime))
    ).map((isAnimeFlag) => ({
      mediaType,
      isAnime: isAnimeFlag === 1,
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
      await runBestEffortPublish("detail/watchlist-upsert:reclassify", async () => {
        await publishScopedWatchUpdates(
          [
            {
              userId,
              revisionScopes: [
                ...previousScopes,
                { mediaType, isAnime },
              ],
            },
          ],
          "watchlist_upsert",
        );
      });
    }
  }

  return NextResponse.json({ ok: true, duplicate: existing.length > 0 });
}
