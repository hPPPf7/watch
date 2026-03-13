import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb, runInTransaction } from "@/server/db/client";
import { watchlistItems, watchlistTvStates } from "@/server/db/schema";
import { publishScopedWatchUpdates } from "@/server/realtime/watchUpdates";
import { runBestEffortPublish } from "@/server/realtime/safePublish";
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

function isNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseCheckedAt(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return { ok: true as const, date: null };
  }
  if (typeof value !== "string") {
    return { ok: false as const, date: null };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { ok: false as const, date: null };
  }
  const matchedDateParts = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
  if (!matchedDateParts) {
    return { ok: false as const, date: null };
  }
  const [, year, month, day] = matchedDateParts;
  if (
    String(date.getUTCFullYear()) !== year ||
    String(date.getUTCMonth() + 1).padStart(2, "0") !== month ||
    String(date.getUTCDate()).padStart(2, "0") !== day
  ) {
    return { ok: false as const, date: null };
  }
  return { ok: true as const, date };
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
  if (!Array.isArray(body?.states)) {
    return NextResponse.json({ ok: true });
  }

  if (body.states.length === 0) {
    return NextResponse.json({ ok: true });
  }

  const states = body.states
    .map((state) => {
      const checkedAtResult = parseCheckedAt(state?.last_checked_at);
      const isValid =
        isNonNegativeInteger(state?.tmdb_id) &&
        state.tmdb_id > 0 &&
        (state?.last_progress === "unwatched" ||
          state?.last_progress === "watching" ||
          state?.last_progress === "completed") &&
        isNonNegativeInteger(state?.last_total_aired) &&
        isNonNegativeInteger(state?.last_watched_count) &&
        checkedAtResult.ok;

      if (!isValid) {
        return null;
      }

      return {
        ...state,
        checkedAt: checkedAtResult.date,
      };
    })
    .filter((state): state is StateInput & { checkedAt: Date | null } => state !== null);

  if (states.length !== body.states.length) {
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

  let didChange = false;
  try {
    didChange = await runInTransaction(async (tx) => {
      let changed = false;
      for (const state of states) {
        const existing = await tx
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

        if (existing.length > 0) {
          const keepRow = chooseWatchlistTvStateKeepRow(existing, state);
          const duplicateIds = existing
            .filter((row) => row.id !== keepRow.id)
            .map((row) => row.id);
          const semanticChanged =
            keepRow.lastProgress !== state.last_progress ||
            (keepRow.lastTotalAired ?? 0) !== state.last_total_aired ||
            (keepRow.lastWatchedCount ?? 0) !== state.last_watched_count;
          await tx
            .update(watchlistTvStates)
            .set({
              lastProgress: state.last_progress,
              lastTotalAired: state.last_total_aired,
              lastWatchedCount: state.last_watched_count,
              checkedAt: state.checkedAt,
              updatedAt: new Date(),
            })
            .where(eq(watchlistTvStates.id, keepRow.id));
          if (duplicateIds.length > 0) {
            await tx
              .delete(watchlistTvStates)
              .where(inArray(watchlistTvStates.id, duplicateIds));
          }
          if (semanticChanged || duplicateIds.length > 0) {
            changed = true;
          }
          continue;
        }

        await tx
          .insert(watchlistTvStates)
          .values({
            projectId: "watch",
            userId,
            tmdbId: state.tmdb_id,
            lastProgress: state.last_progress,
            lastTotalAired: state.last_total_aired,
            lastWatchedCount: state.last_watched_count,
            checkedAt: state.checkedAt,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              watchlistTvStates.projectId,
              watchlistTvStates.userId,
              watchlistTvStates.tmdbId,
            ],
            set: {
              lastProgress: state.last_progress,
              lastTotalAired: state.last_total_aired,
              lastWatchedCount: state.last_watched_count,
              checkedAt: state.checkedAt,
              updatedAt: new Date(),
            },
          });
        changed = true;
      }
      return changed;
    });
  } catch (error) {
    console.error("[watchlist/tv-states/upsert] failed", { userId, error });
    const details =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : JSON.stringify(error);
    return NextResponse.json(
      {
        code: "UPSERT_FAILED",
        message: "Upsert tv states failed",
        ...(process.env.NODE_ENV !== "production" ? { details } : {}),
      },
      { status: 500 },
    );
  }

  if (didChange) {
    let publishTargets: Array<
      | string
      | {
          userId: string;
          revisionScopes: Array<{ mediaType: "tv"; isAnime: boolean }>;
        }
    > = [userId];
    try {
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
      publishTargets =
        revisionScopes.length > 0 ? [{ userId, revisionScopes }] : [userId];
    } catch (error) {
      console.warn("[watchlist/tv-states/upsert] supplemental refresh lookup failed", {
        userId,
        error,
      });
    }

    await runBestEffortPublish("watchlist/tv-states/upsert", async () => {
      await publishScopedWatchUpdates(
        publishTargets,
        "watchlist_tv_states_upsert"
      );
    });
  }

  return NextResponse.json({ ok: true });
}

