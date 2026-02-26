import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchlistTvStates } from "@/server/db/schema";

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

  for (const state of states) {
    const existing = await db
      .select({ id: watchlistTvStates.id })
      .from(watchlistTvStates)
      .where(
        and(
          eq(watchlistTvStates.userId, userId),
          eq(watchlistTvStates.projectId, "watch"),
          eq(watchlistTvStates.tmdbId, state.tmdb_id)
        )
      )
      .limit(1);

    const checkedAt = state.last_checked_at ? new Date(state.last_checked_at) : null;
    if (existing.length > 0) {
      await db
        .update(watchlistTvStates)
        .set({
          lastProgress: state.last_progress,
          lastTotalAired: state.last_total_aired,
          lastWatchedCount: state.last_watched_count,
          checkedAt,
          updatedAt: new Date(),
        })
        .where(eq(watchlistTvStates.id, existing[0].id));
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
    }
  }

  return NextResponse.json({ ok: true });
}

