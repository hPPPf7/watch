import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb, runInTransaction } from "@/server/db/client";
import { tmdbCache, watchlistItems, watchlistTvStates } from "@/server/db/schema";
import { publishScopedWatchUpdates } from "@/server/realtime/watchUpdates";
import { runBestEffortPublish } from "@/server/realtime/safePublish";
import { acquireWatchlistItemLock } from "@/server/services/watchlistItemMutationService";
import {
  PERSISTED_TV_STATE_RETURNING,
  toClientPersistedTvState,
} from "@/server/services/watchlistTvStateService";
import { TMDB_CACHE_KEYS } from "@/server/tmdb/cache";

type Body = {
  tmdbId?: number;
  alertGeneration?: string;
  firstRelease?: boolean;
};

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Not signed in" },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  if (
    typeof body?.tmdbId !== "number" ||
    !Number.isInteger(body.tmdbId) ||
    body.tmdbId <= 0
  ) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid tmdbId" },
      { status: 400 },
    );
  }
  if (
    typeof body.alertGeneration !== "string" ||
    body.alertGeneration.length === 0 ||
    body.alertGeneration.length > 128
  ) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid alertGeneration" },
      { status: 400 },
    );
  }
  const tmdbId = body.tmdbId;
  const alertGeneration = body.alertGeneration;
  const firstRelease = body.firstRelease === true;

  try {
    getDb();
  } catch {
    return NextResponse.json(
      { code: "CONFIG_MISSING", message: "DATABASE_URL is required" },
      { status: 500 },
    );
  }

  const updatedAt = new Date();
  const result = await runInTransaction(async (tx) => {
    await acquireWatchlistItemLock(tx, userId, tmdbId);
    const watchlistRows = await tx
      .select({
        isAnime: watchlistItems.isAnime,
      })
      .from(watchlistItems)
      .where(
        and(
          eq(watchlistItems.userId, userId),
          eq(watchlistItems.mediaType, "tv"),
          eq(watchlistItems.tmdbId, tmdbId),
        ),
      );
    if (watchlistRows.length === 0) return null;
    const metadataKeys = [
      TMDB_CACHE_KEYS.detail("tv", String(tmdbId)),
    ];
    const episodeGeneration = alertGeneration.match(/^episode:(\d+):\d+$/);
    if (episodeGeneration) {
      metadataKeys.push(
        TMDB_CACHE_KEYS.season("tv", String(tmdbId), episodeGeneration[1]),
      );
    }
    const metadataCacheRows = await tx
      .select({ updatedAt: tmdbCache.updatedAt })
      .from(tmdbCache)
      .where(inArray(tmdbCache.key, metadataKeys));
    const metadataFetchedAtValues = metadataCacheRows
      .map((row) => row.updatedAt)
      .filter((value): value is Date => value instanceof Date);
    const sourceMetadataFetchedAt =
      metadataFetchedAtValues.length === metadataKeys.length
        ? metadataFetchedAtValues.sort(
            (left, right) => left.getTime() - right.getTime(),
          )[0]
        : new Date(0);

    const [persistedRow] = await tx
      .insert(watchlistTvStates)
      .values({
        userId,
        tmdbId,
        lastProgress: "unwatched",
        lastTotalAired: 0,
        lastWatchedCount: 0,
        alertActive: false,
        alertNotifiedWatchCount: 0,
        alertStartedAt: null,
        alertGeneration: null,
        alertAcknowledgedGeneration: alertGeneration,
        firstReleaseAlertState: firstRelease ? "acknowledged" : null,
        tmdbMetadataFetchedAt: sourceMetadataFetchedAt,
        checkedAt: updatedAt,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [watchlistTvStates.userId, watchlistTvStates.tmdbId],
        set: {
          alertActive: sql<boolean>`CASE
            WHEN ${watchlistTvStates.alertGeneration} IS NULL
              OR ${watchlistTvStates.alertGeneration} = ${alertGeneration}
            THEN false
            ELSE ${watchlistTvStates.alertActive}
          END`,
          alertStartedAt: sql<Date | null>`CASE
            WHEN ${watchlistTvStates.alertGeneration} IS NULL
              OR ${watchlistTvStates.alertGeneration} = ${alertGeneration}
            THEN NULL
            ELSE ${watchlistTvStates.alertStartedAt}
          END`,
          alertAcknowledgedGeneration: sql<string | null>`CASE
            WHEN ${watchlistTvStates.alertGeneration} IS NULL
              OR ${watchlistTvStates.alertGeneration} = ${alertGeneration}
            THEN ${alertGeneration}
            ELSE ${watchlistTvStates.alertAcknowledgedGeneration}
          END`,
          ...(firstRelease
            ? {
                firstReleaseAlertState: sql<string | null>`CASE
                  WHEN ${watchlistTvStates.alertGeneration} IS NULL
                    OR ${watchlistTvStates.alertGeneration} = ${alertGeneration}
                  THEN 'acknowledged'
                  ELSE ${watchlistTvStates.firstReleaseAlertState}
                END`,
              }
            : {}),
          updatedAt,
        },
      })
      .returning(PERSISTED_TV_STATE_RETURNING);

    const revisionScopes = Array.from(
      new Set(watchlistRows.map((row) => row.isAnime === 1)),
    ).map((isAnime) => ({ mediaType: "tv" as const, isAnime }));
    return { revisionScopes, persistedRow };
  });
  if (!result) {
    return NextResponse.json({ ok: true, changed: false });
  }
  const { revisionScopes, persistedRow } = result;

  await runBestEffortPublish("watchlist/tv-states/acknowledge", async () => {
    await publishScopedWatchUpdates(
      [
        {
          userId,
          revisionScopes,
        },
      ],
      "watchlist_tv_state_alert_acknowledged",
    );
  });

  return NextResponse.json({
    ok: true,
    changed: true,
    persistedState: persistedRow
      ? toClientPersistedTvState(tmdbId, persistedRow)
      : undefined,
  });
}
