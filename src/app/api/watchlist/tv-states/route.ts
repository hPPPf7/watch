import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { selectLatestWatchlistTvStates } from "@/server/services/watchlistTvStateService";

type Body = {
  tmdbIds?: number[];
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const toIsoString = (value: Date | string | null | undefined) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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
  const rawTmdbIds = Array.isArray(body?.tmdbIds) ? body!.tmdbIds : [];
  if (rawTmdbIds.some((id) => !isPositiveInteger(id))) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid tmdbIds" },
      { status: 400 },
    );
  }
  const tmdbIds = rawTmdbIds as number[];
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

  const latestRows = await selectLatestWatchlistTvStates(db, userId, tmdbIds);

  const normalized = latestRows.map((row) => ({
    tmdb_id: row.tmdb_id,
    last_progress: (row.last_progress ?? "unwatched") as
      | "unwatched"
      | "watching"
      | "completed",
    last_total_aired: row.last_total_aired ?? 0,
    last_watched_count: row.last_watched_count ?? 0,
    alert_active: row.alert_active,
    alert_notified_watch_count: row.alert_notified_watch_count,
    next_episode_season: row.next_episode_season,
    next_episode_number: row.next_episode_number,
    next_episode_name: row.next_episode_name,
    next_episode_air_date: row.next_episode_air_date,
    last_watched_season: row.last_watched_season,
    last_watched_episode: row.last_watched_episode,
    last_known_status: null as string | null,
    last_checked_at: toIsoString(row.checked_at),
    alert_started_at: toIsoString(row.alert_started_at),
    alert_generation: row.alert_generation,
    alert_acknowledged_generation: row.alert_acknowledged_generation,
    first_release_alert_state: row.first_release_alert_state,
  }));

  return NextResponse.json({ rows: normalized });
}

