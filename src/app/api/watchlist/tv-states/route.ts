import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { watchlistTvStates } from "@/server/db/schema";

type Body = {
  tmdbIds?: number[];
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
  const tmdbIds = Array.isArray(body?.tmdbIds)
    ? body!.tmdbIds.filter((id): id is number => typeof id === "number")
    : [];
  if (tmdbIds.length === 0) {
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
      id: watchlistTvStates.id,
      tmdb_id: watchlistTvStates.tmdbId,
      last_progress: watchlistTvStates.lastProgress,
      last_total_aired: watchlistTvStates.lastTotalAired,
      last_watched_count: watchlistTvStates.lastWatchedCount,
      checked_at: watchlistTvStates.checkedAt,
      updated_at: watchlistTvStates.updatedAt,
    })
    .from(watchlistTvStates)
    .where(
      and(
        eq(watchlistTvStates.userId, userId),
        eq(watchlistTvStates.projectId, "watch"),
        inArray(watchlistTvStates.tmdbId, tmdbIds)
      )
    )
    .orderBy(desc(watchlistTvStates.updatedAt), desc(watchlistTvStates.id));

  const latestRows = Array.from(
    rows.reduce((map, row) => {
      if (!map.has(row.tmdb_id)) {
        map.set(row.tmdb_id, row);
      }
      return map;
    }, new Map<number, (typeof rows)[number]>()).values()
  );

  const normalized = latestRows.map((row) => ({
    tmdb_id: row.tmdb_id,
    last_progress: (row.last_progress ?? "unwatched") as
      | "unwatched"
      | "watching"
      | "completed",
    last_total_aired: row.last_total_aired ?? 0,
    last_watched_count: row.last_watched_count ?? 0,
    alert_active: false,
    alert_notified_watch_count: 0,
    last_known_status: null as string | null,
    last_checked_at:
      row.checked_at instanceof Date ? row.checked_at.toISOString() : null,
    alert_started_at: null as string | null,
  }));

  return NextResponse.json({ rows: normalized });
}

