import { NextResponse } from "next/server";
import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { tmdbCache, watchlistTvStates } from "@/server/db/schema";

const TV_STATE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

const verifyCronAccess = (request: Request) => {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = request.headers.get("authorization");
  if (bearer === `Bearer ${expected}`) return true;
  const fromHeader = request.headers.get("x-cron-secret");
  return fromHeader === expected;
};

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "CRON_SECRET is required" },
      { status: 500 },
    );
  }
  if (!verifyCronAccess(request)) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Invalid cron secret" },
      { status: 401 },
    );
  }

  let db;
  try {
    db = getDb();
  } catch {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "DATABASE_URL is required" },
      { status: 500 },
    );
  }

  const now = new Date();
  const deleted = await db
    .delete(tmdbCache)
    .where(lt(tmdbCache.expiresAt, now))
    .returning({ key: tmdbCache.key });
  const staleBefore = new Date(now.getTime() - TV_STATE_MAX_AGE_MS);
  const cleanedTvStates = await db
    .update(watchlistTvStates)
    .set({
      lastTotalAired: null,
      alertActive: false,
      alertStartedAt: null,
      alertGeneration: null,
      alertAcknowledgedGeneration: null,
      firstReleaseAlertState: sql<string | null>`CASE
        WHEN ${watchlistTvStates.firstReleaseAlertState} = 'active'
        THEN 'acknowledged'
        ELSE ${watchlistTvStates.firstReleaseAlertState}
      END`,
      nextEpisodeSeason: null,
      nextEpisodeNumber: null,
      nextEpisodeName: null,
      nextEpisodeAirDate: null,
      tmdbMetadataFetchedAt: null,
      checkedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        sql`COALESCE(
          ${watchlistTvStates.tmdbMetadataFetchedAt},
          ${watchlistTvStates.createdAt},
          '-infinity'::timestamptz
        ) < ${staleBefore}`,
        or(
          isNotNull(watchlistTvStates.lastTotalAired),
          eq(watchlistTvStates.alertActive, true),
          isNotNull(watchlistTvStates.alertGeneration),
          isNotNull(watchlistTvStates.alertAcknowledgedGeneration),
          isNotNull(watchlistTvStates.nextEpisodeSeason),
          isNotNull(watchlistTvStates.nextEpisodeNumber),
          isNotNull(watchlistTvStates.nextEpisodeName),
          isNotNull(watchlistTvStates.nextEpisodeAirDate),
        ),
      ),
    )
    .returning({ id: watchlistTvStates.id });

  return NextResponse.json({
    ok: true,
    deleted: deleted.length,
    staleTvStatesCleaned: cleanedTvStates.length,
    cleanedAt: now.toISOString(),
  });
}
