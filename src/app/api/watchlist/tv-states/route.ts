import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { selectLatestWatchlistTvStates } from "@/server/services/watchlistTvStateService";

type Body = {
  tmdbIds?: number[];
};

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

  const latestRows = await selectLatestWatchlistTvStates(db, userId, tmdbIds);

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
    last_checked_at: toIsoString(row.checked_at),
    alert_started_at: null as string | null,
  }));

  return NextResponse.json({ rows: normalized });
}

