import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchlistItems, watchlistTvStates } from "@/server/db/schema";
import { publishScopedWatchUpdates } from "@/server/realtime/watchUpdates";
import { chooseWatchlistTvStateKeepRow } from "@/server/services/watchlistTvStateService";

type StateInput = {
  tmdb_id: number;
  last_progress: "unwatched" | "watching" | "completed";
  last_total_aired: number;
  last_watched_count: number;
  last_checked_at?: string | null;
};

type Body = {
  states?: StateInput[];
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
  const states = Array.isArray(body?.states)
    ? body!.states.filter(
        (state): state is StateInput =>
          typeof state.tmdb_id === "number" &&
          (state.last_progress === "unwatched" ||
            state.last_progress === "watching" ||
            state.last_progress === "completed")
      )
    : [];
  if (states.length === 0) {
    return NextResponse.json({ ok: true });
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

  let didChange = false;
  for (const state of states) {
    const existing = await db
      .select({
        id: watchlistTvStates.id,
        lastProgress: watchlistTvStates.lastProgress,
        lastTotalAired: watchlistTvStates.lastTotalAired,
        lastWatchedCount: watchlistTvStates.lastWatchedCount,
      })
      .from(watchlistTvStates)
      .where(
        and(
          eq(watchlistTvStates.userId, userId),
          eq(watchlistTvStates.projectId, "watch"),
          eq(watchlistTvStates.tmdbId, state.tmdb_id)
        )
      );

    const checkedAt = state.last_checked_at ? new Date(state.last_checked_at) : null;
    if (existing.length > 0) {
      const keepRow = chooseWatchlistTvStateKeepRow(existing, state);
      const duplicateIds = existing
        .filter((row) => row.id !== keepRow.id)
        .map((row) => row.id);
      const semanticChanged =
        keepRow.lastProgress !== state.last_progress ||
        (keepRow.lastTotalAired ?? 0) !== state.last_total_aired ||
        (keepRow.lastWatchedCount ?? 0) !== state.last_watched_count;
      await db
        .update(watchlistTvStates)
        .set({
          lastProgress: state.last_progress,
          lastTotalAired: state.last_total_aired,
          lastWatchedCount: state.last_watched_count,
          checkedAt,
          updatedAt: new Date(),
        })
        .where(eq(watchlistTvStates.id, keepRow.id));
      if (duplicateIds.length > 0) {
        await db
          .delete(watchlistTvStates)
          .where(inArray(watchlistTvStates.id, duplicateIds));
      }
      if (semanticChanged || duplicateIds.length > 0) {
        didChange = true;
      }
    } else {
      await db.insert(watchlistTvStates).values({
        projectId: "watch",
        userId,
        tmdbId: state.tmdb_id,
        lastProgress: state.last_progress,
        lastTotalAired: state.last_total_aired,
        lastWatchedCount: state.last_watched_count,
        checkedAt,
        updatedAt: new Date(),
      });
      didChange = true;
    }
  }

  if (didChange) {
    const tmdbIds = Array.from(new Set(states.map((state) => state.tmdb_id)));
    const watchlistRows =
      tmdbIds.length === 0
        ? []
        : await db
            .select({
              tmdbId: watchlistItems.tmdbId,
              isAnime: watchlistItems.isAnime,
            })
            .from(watchlistItems)
            .where(
              and(
                eq(watchlistItems.userId, userId),
                eq(watchlistItems.projectId, "watch"),
                eq(watchlistItems.mediaType, "tv"),
                inArray(watchlistItems.tmdbId, tmdbIds)
              )
            );

    const revisionScopes = Array.from(
      new Set(watchlistRows.map((row) => row.isAnime))
    ).map((isAnimeFlag) => ({
      mediaType: "tv" as const,
      isAnime: isAnimeFlag === 1,
    }));

    await publishScopedWatchUpdates(
      revisionScopes.length > 0
        ? [{ userId, revisionScopes }]
        : [userId],
      "watchlist_tv_states_upsert"
    );
  }

  return NextResponse.json({ ok: true });
}

