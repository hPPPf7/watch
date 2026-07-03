import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb, runInTransaction } from "@/server/db/client";
import { tmdbCache, watchlistItems, watchlistTvStates } from "@/server/db/schema";
import { publishScopedWatchUpdates } from "@/server/realtime/watchUpdates";
import { runBestEffortPublish } from "@/server/realtime/safePublish";
import { acquireWatchlistItemLock } from "@/server/services/watchlistItemMutationService";
import { chooseWatchlistTvStateKeepRow } from "@/server/services/watchlistTvStateService";
import { getWatchlistRevisionConflict } from "@/server/services/watchlistRevisionService";
import { refreshCalendarMetadataIfTitleNeedsRefresh } from "@/server/tmdb/calendarMetadata";
import { TMDB_CACHE_KEYS } from "@/server/tmdb/cache";

const MAX_BACKGROUND_TITLE_REFRESHES = 5;

type StateInput = {
  tmdb_id: number;
  last_progress: "unwatched" | "watching" | "completed";
  last_total_aired: number;
  last_watched_count: number;
  alert_active?: boolean;
  alert_notified_watch_count?: number;
  alert_started_at?: string | null;
  alert_generation?: string | null;
  first_release_alert_state?: "pending" | "active" | "acknowledged" | null;
  next_episode_season?: number | null;
  next_episode_number?: number | null;
  next_episode_name?: string | null;
  next_episode_air_date?: string | null;
  last_watched_season?: number | null;
  last_watched_episode?: number | null;
  last_checked_at?: string | null;
};

type Body = {
  states?: StateInput[];
  isAnime?: boolean;
  baseRevision?: string;
  force?: boolean;
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
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const normalized = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
  if (
    normalized.getUTCFullYear() !== yearNumber ||
    normalized.getUTCMonth() + 1 !== monthNumber ||
    normalized.getUTCDate() !== dayNumber
  ) {
    return { ok: false as const, date: null };
  }
  return { ok: true as const, date };
}

function parseOptionalTimestamp(value: unknown) {
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
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const normalized = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
  if (
    normalized.getUTCFullYear() !== yearNumber ||
    normalized.getUTCMonth() + 1 !== monthNumber ||
    normalized.getUTCDate() !== dayNumber
  ) {
    return { ok: false as const, date: null };
  }
  return { ok: true as const, date };
}

function parseOptionalDateKey(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return { ok: true as const, value: null };
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false as const, value: null };
  }
  const [year, month, day] = value.split("-").map(Number);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() + 1 !== month ||
    normalized.getUTCDate() !== day
  ) {
    return { ok: false as const, value: null };
  }
  return { ok: true as const, value };
}

function parseOptionalEpisodeNumber(value: unknown) {
  if (value === undefined || value === null) {
    return { ok: true as const, value: null };
  }
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? { ok: true as const, value }
    : { ok: false as const, value: null };
}

function parseOptionalEpisodeName(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return { ok: true as const, value: null };
  }
  return typeof value === "string" && value.length <= 500
    ? { ok: true as const, value }
    : { ok: false as const, value: null };
}

function parseOptionalAlertGeneration(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return { ok: true as const, value: null };
  }
  return typeof value === "string" && value.length <= 128
    ? { ok: true as const, value }
    : { ok: false as const, value: null };
}

function toComparableTimestamp(value: Date | string | null | undefined) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function toDatabaseTimestamp(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const refreshCalendarMetadataInBackground = (
  tmdbIds: Iterable<number>,
  userId: string,
) => {
  const candidates = Array.from(tmdbIds).slice(0, MAX_BACKGROUND_TITLE_REFRESHES);
  if (candidates.length === 0) return;

  void Promise.allSettled(
    candidates.map((tmdbId) =>
      refreshCalendarMetadataIfTitleNeedsRefresh("tv", tmdbId),
    ),
  ).then((results) => {
    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length === 0) return;
    console.warn("[watchlist/tv-states/upsert] title refresh failed", {
      userId,
      failedCount: failed.length,
    });
  });
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
  if (!Array.isArray(body?.states)) {
    return NextResponse.json({ ok: true });
  }

  if (body.states.length === 0) {
    return NextResponse.json({ ok: true });
  }

  const states = body.states
    .map((state) => {
      const checkedAtResult = parseCheckedAt(state?.last_checked_at);
      const alertStartedAtResult = parseOptionalTimestamp(state?.alert_started_at);
      const alertGenerationResult = parseOptionalAlertGeneration(
        state?.alert_generation,
      );
      const nextEpisodeSeasonResult = parseOptionalEpisodeNumber(
        state?.next_episode_season,
      );
      const nextEpisodeNumberResult = parseOptionalEpisodeNumber(
        state?.next_episode_number,
      );
      const nextEpisodeNameResult = parseOptionalEpisodeName(
        state?.next_episode_name,
      );
      const nextEpisodeAirDateResult = parseOptionalDateKey(
        state?.next_episode_air_date,
      );
      const lastWatchedSeasonResult = parseOptionalEpisodeNumber(
        state?.last_watched_season,
      );
      const lastWatchedEpisodeResult = parseOptionalEpisodeNumber(
        state?.last_watched_episode,
      );
      const isValid =
        isNonNegativeInteger(state?.tmdb_id) &&
        state.tmdb_id > 0 &&
        (state?.last_progress === "unwatched" ||
          state?.last_progress === "watching" ||
          state?.last_progress === "completed") &&
        isNonNegativeInteger(state?.last_total_aired) &&
        isNonNegativeInteger(state?.last_watched_count) &&
        (state?.alert_active === undefined ||
          typeof state.alert_active === "boolean") &&
        (state?.alert_notified_watch_count === undefined ||
          isNonNegativeInteger(state.alert_notified_watch_count)) &&
        (state?.first_release_alert_state === undefined ||
          state.first_release_alert_state === null ||
          state.first_release_alert_state === "pending" ||
          state.first_release_alert_state === "active" ||
          state.first_release_alert_state === "acknowledged") &&
        checkedAtResult.ok &&
        alertStartedAtResult.ok &&
        alertGenerationResult.ok &&
        nextEpisodeSeasonResult.ok &&
        nextEpisodeNumberResult.ok &&
        nextEpisodeNameResult.ok &&
        nextEpisodeAirDateResult.ok &&
        lastWatchedSeasonResult.ok &&
        lastWatchedEpisodeResult.ok;

      if (!isValid) {
        return null;
      }

      return {
        ...state,
        hasAlertActive: state?.alert_active !== undefined,
        hasAlertNotifiedWatchCount:
          state?.alert_notified_watch_count !== undefined,
        hasAlertStartedAt: state?.alert_started_at !== undefined,
        hasAlertGeneration: state?.alert_generation !== undefined,
        hasFirstReleaseAlertState:
          state?.first_release_alert_state !== undefined,
        hasNextEpisodeSeason: state?.next_episode_season !== undefined,
        hasNextEpisodeNumber: state?.next_episode_number !== undefined,
        hasNextEpisodeName: state?.next_episode_name !== undefined,
        hasNextEpisodeAirDate: state?.next_episode_air_date !== undefined,
        hasLastWatchedSeason: state?.last_watched_season !== undefined,
        hasLastWatchedEpisode: state?.last_watched_episode !== undefined,
        alert_active: state?.alert_active ?? false,
        alert_notified_watch_count: state?.alert_notified_watch_count ?? 0,
        alertStartedAt: alertStartedAtResult.date,
        alert_generation: alertGenerationResult.value,
        next_episode_season: nextEpisodeSeasonResult.value,
        next_episode_number: nextEpisodeNumberResult.value,
        next_episode_name: nextEpisodeNameResult.value,
        next_episode_air_date: nextEpisodeAirDateResult.value,
        last_watched_season: lastWatchedSeasonResult.value,
        last_watched_episode: lastWatchedEpisodeResult.value,
        checkedAt: checkedAtResult.date,
      };
    })
    .filter(
      (
        state,
      ): state is StateInput & {
        hasAlertActive: boolean;
        hasAlertNotifiedWatchCount: boolean;
        hasAlertStartedAt: boolean;
        hasAlertGeneration: boolean;
        hasFirstReleaseAlertState: boolean;
        hasNextEpisodeSeason: boolean;
        hasNextEpisodeNumber: boolean;
        hasNextEpisodeName: boolean;
        hasNextEpisodeAirDate: boolean;
        hasLastWatchedSeason: boolean;
        hasLastWatchedEpisode: boolean;
        alert_active: boolean;
        alert_notified_watch_count: number;
        alertStartedAt: Date | null;
        alert_generation: string | null;
        next_episode_season: number | null;
        next_episode_number: number | null;
        next_episode_name: string | null;
        next_episode_air_date: string | null;
        last_watched_season: number | null;
        last_watched_episode: number | null;
        checkedAt: Date | null;
      } => state !== null,
    );

  if (states.length !== body.states.length) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "Invalid payload" },
      { status: 400 }
    );
  }

  const revisionConflict = await getWatchlistRevisionConflict(
    userId,
    "tv",
    body.isAnime === true,
    body.baseRevision,
    body.force,
  ).catch((error) => {
    console.warn("[watchlist/tv-states/upsert] revision check failed", {
      userId,
      isAnime: body.isAnime === true,
      error,
    });
    return null;
  });
  if (revisionConflict) {
    return NextResponse.json(revisionConflict, { status: 409 });
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
  const titleRefreshCandidateIds = new Set<number>();
  try {
    didChange = await runInTransaction(async (tx) => {
      let changed = false;
      const stateTmdbIds = Array.from(
        new Set(states.map((state) => state.tmdb_id)),
      ).sort((left, right) => left - right);
      for (const tmdbId of stateTmdbIds) {
        await acquireWatchlistItemLock(tx, userId, tmdbId);
      }
      const currentWatchlistRows =
        stateTmdbIds.length === 0
          ? []
          : await tx
              .select({ tmdbId: watchlistItems.tmdbId })
              .from(watchlistItems)
              .where(
                and(
                  eq(watchlistItems.userId, userId),
                  eq(watchlistItems.mediaType, "tv"),
                  inArray(watchlistItems.tmdbId, stateTmdbIds),
                ),
              );
      const currentWatchlistTmdbIds = new Set(
        currentWatchlistRows.map((row) => row.tmdbId),
      );
      const metadataKeysByTmdbId = new Map<number, string[]>();
      for (const state of states) {
        const keys = metadataKeysByTmdbId.get(state.tmdb_id) ?? [
          TMDB_CACHE_KEYS.detail("tv", String(state.tmdb_id)),
        ];
        const episodeGeneration = state.alert_generation?.match(
          /^episode:(\d+):\d+$/,
        );
        const sourceSeason =
          state.next_episode_season ??
          (episodeGeneration ? Number(episodeGeneration[1]) : null);
        if (sourceSeason) {
          keys.push(
            TMDB_CACHE_KEYS.season(
              "tv",
              String(state.tmdb_id),
              String(sourceSeason),
            ),
          );
        }
        metadataKeysByTmdbId.set(state.tmdb_id, Array.from(new Set(keys)));
      }
      const metadataKeys = Array.from(
        new Set(Array.from(metadataKeysByTmdbId.values()).flat()),
      );
      const metadataCacheRows =
        metadataKeys.length === 0
          ? []
          : await tx
              .select({
                key: tmdbCache.key,
                updatedAt: tmdbCache.updatedAt,
              })
              .from(tmdbCache)
              .where(inArray(tmdbCache.key, metadataKeys));
      const metadataFetchedAtByKey = new Map(
        metadataCacheRows.map((row) => [row.key, row.updatedAt]),
      );
      const sourceMetadataFetchedAtByTmdbId = new Map<number, Date>();
      for (const [tmdbId, keys] of metadataKeysByTmdbId) {
        const fetchedAtValues = keys
          .map((key) => metadataFetchedAtByKey.get(key))
          .filter((value): value is Date => value instanceof Date);
        if (fetchedAtValues.length !== keys.length) continue;
        const oldestFetchedAt = fetchedAtValues.sort(
          (left, right) => left.getTime() - right.getTime(),
        )[0];
        sourceMetadataFetchedAtByTmdbId.set(tmdbId, oldestFetchedAt);
      }

      for (const state of states) {
        if (!currentWatchlistTmdbIds.has(state.tmdb_id)) continue;
        const sourceMetadataFetchedAt =
          sourceMetadataFetchedAtByTmdbId.get(state.tmdb_id) ?? null;
        const existing = await tx
          .select({
            id: watchlistTvStates.id,
            lastProgress: watchlistTvStates.lastProgress,
            lastTotalAired: watchlistTvStates.lastTotalAired,
            lastWatchedCount: watchlistTvStates.lastWatchedCount,
            alertActive: watchlistTvStates.alertActive,
            alertNotifiedWatchCount: watchlistTvStates.alertNotifiedWatchCount,
            alertStartedAt: watchlistTvStates.alertStartedAt,
            alertGeneration: watchlistTvStates.alertGeneration,
            alertAcknowledgedGeneration:
              watchlistTvStates.alertAcknowledgedGeneration,
            firstReleaseAlertState: watchlistTvStates.firstReleaseAlertState,
            tmdbMetadataFetchedAt: watchlistTvStates.tmdbMetadataFetchedAt,
            nextEpisodeSeason: watchlistTvStates.nextEpisodeSeason,
            nextEpisodeNumber: watchlistTvStates.nextEpisodeNumber,
            nextEpisodeName: watchlistTvStates.nextEpisodeName,
            nextEpisodeAirDate: watchlistTvStates.nextEpisodeAirDate,
            lastWatchedSeason: watchlistTvStates.lastWatchedSeason,
            lastWatchedEpisode: watchlistTvStates.lastWatchedEpisode,
          })
          .from(watchlistTvStates)
          .where(
            and(
              eq(watchlistTvStates.userId, userId),
              eq(watchlistTvStates.tmdbId, state.tmdb_id)
            )
          );

        if (existing.length > 0) {
          const keepRow = chooseWatchlistTvStateKeepRow(existing, state, {
            // 舊 caller 尚未帶 alert_* 欄位時，若歷史上殘留 duplicate rows，
            // 這裡優先保留提醒資訊較完整的那筆，避免 dedupe 時把有效提醒洗掉。
            preferAlertMetadata:
              !state.hasAlertActive &&
              !state.hasAlertNotifiedWatchCount &&
              !state.hasAlertStartedAt &&
              !state.hasAlertGeneration &&
              !state.hasFirstReleaseAlertState,
          });
          const nextAlertActive = state.hasAlertActive
            ? state.alert_active
            : keepRow.alertActive;
          const nextAlertNotifiedWatchCount = state.hasAlertNotifiedWatchCount
            ? state.alert_notified_watch_count
            : keepRow.alertNotifiedWatchCount;
          const nextAlertStartedAt = state.hasAlertStartedAt
            ? state.alertStartedAt
            : toDatabaseTimestamp(keepRow.alertStartedAt);
          const nextAlertGeneration = state.hasAlertGeneration
            ? state.alert_generation
            : keepRow.alertGeneration ?? null;
          const alertAcknowledgedGeneration =
            keepRow.alertAcknowledgedGeneration ?? null;
          const nextFirstReleaseAlertState = state.hasFirstReleaseAlertState
            ? state.first_release_alert_state ?? null
            : keepRow.firstReleaseAlertState ?? null;
          const isAlertAlreadyAcknowledged = Boolean(
              nextAlertActive &&
              nextAlertGeneration &&
              alertAcknowledgedGeneration === nextAlertGeneration,
          );
          const normalizedAlertActive = isAlertAlreadyAcknowledged
            ? false
            : nextAlertActive;
          const normalizedAlertStartedAt = isAlertAlreadyAcknowledged
            ? null
            : nextAlertStartedAt;
          const normalizedFirstReleaseAlertState =
            isAlertAlreadyAcknowledged &&
            nextFirstReleaseAlertState === "active"
              ? "acknowledged"
              : nextFirstReleaseAlertState;
          const guardedAlertActive =
            normalizedAlertActive && nextAlertGeneration
              ? sql<boolean>`CASE
                  WHEN ${watchlistTvStates.alertAcknowledgedGeneration} = ${nextAlertGeneration}
                  THEN false
                  ELSE true
                END`
              : normalizedAlertActive;
          const guardedAlertStartedAt =
            normalizedAlertActive && nextAlertGeneration
              ? sql<Date | null>`CASE
                  WHEN ${watchlistTvStates.alertAcknowledgedGeneration} = ${nextAlertGeneration}
                  THEN NULL
                  ELSE ${normalizedAlertStartedAt}
                END`
              : normalizedAlertStartedAt;
          const guardedFirstReleaseAlertState =
            normalizedFirstReleaseAlertState === "active" &&
            nextAlertGeneration
              ? sql<string>`CASE
                  WHEN ${watchlistTvStates.alertAcknowledgedGeneration} = ${nextAlertGeneration}
                  THEN 'acknowledged'
                  ELSE 'active'
                END`
              : normalizedFirstReleaseAlertState;
          const nextEpisodeSeason = state.hasNextEpisodeSeason
            ? state.next_episode_season
            : keepRow.nextEpisodeSeason ?? null;
          const nextEpisodeNumber = state.hasNextEpisodeNumber
            ? state.next_episode_number
            : keepRow.nextEpisodeNumber ?? null;
          const nextEpisodeName = state.hasNextEpisodeName
            ? state.next_episode_name
            : keepRow.nextEpisodeName ?? null;
          const nextEpisodeAirDate = state.hasNextEpisodeAirDate
            ? state.next_episode_air_date
            : keepRow.nextEpisodeAirDate ?? null;
          const lastWatchedSeason = state.hasLastWatchedSeason
            ? state.last_watched_season
            : keepRow.lastWatchedSeason ?? null;
          const lastWatchedEpisode = state.hasLastWatchedEpisode
            ? state.last_watched_episode
            : keepRow.lastWatchedEpisode ?? null;
          const duplicateIds = existing
            .filter((row) => row.id !== keepRow.id)
            .map((row) => row.id);
          const shouldAdvanceMetadataFetchedAt =
            sourceMetadataFetchedAt !== null &&
            (!keepRow.tmdbMetadataFetchedAt ||
              sourceMetadataFetchedAt.getTime() >
                new Date(keepRow.tmdbMetadataFetchedAt).getTime());
          const semanticChanged =
            keepRow.lastProgress !== state.last_progress ||
            (keepRow.lastTotalAired ?? 0) !== state.last_total_aired ||
            (keepRow.lastWatchedCount ?? 0) !== state.last_watched_count ||
            keepRow.alertActive !== normalizedAlertActive ||
            (keepRow.alertNotifiedWatchCount ?? 0) !==
              nextAlertNotifiedWatchCount ||
            toComparableTimestamp(keepRow.alertStartedAt) !==
              toComparableTimestamp(normalizedAlertStartedAt) ||
            (keepRow.alertGeneration ?? null) !== nextAlertGeneration ||
            (keepRow.firstReleaseAlertState ?? null) !==
              normalizedFirstReleaseAlertState ||
            (keepRow.nextEpisodeSeason ?? null) !== nextEpisodeSeason ||
            (keepRow.nextEpisodeNumber ?? null) !== nextEpisodeNumber ||
            (keepRow.nextEpisodeName ?? null) !== nextEpisodeName ||
            (keepRow.nextEpisodeAirDate ?? null) !== nextEpisodeAirDate ||
            (keepRow.lastWatchedSeason ?? null) !== lastWatchedSeason ||
            (keepRow.lastWatchedEpisode ?? null) !== lastWatchedEpisode;
          await tx
            .update(watchlistTvStates)
            .set({
              lastProgress: state.last_progress,
              lastTotalAired: state.last_total_aired,
              lastWatchedCount: state.last_watched_count,
              alertActive: guardedAlertActive,
              alertNotifiedWatchCount: nextAlertNotifiedWatchCount,
              alertStartedAt: guardedAlertStartedAt,
              alertGeneration: nextAlertGeneration,
              firstReleaseAlertState: guardedFirstReleaseAlertState,
              nextEpisodeSeason,
              nextEpisodeNumber,
              nextEpisodeName,
              nextEpisodeAirDate,
              lastWatchedSeason,
              lastWatchedEpisode,
              checkedAt: state.checkedAt,
              ...(shouldAdvanceMetadataFetchedAt
                ? { tmdbMetadataFetchedAt: sourceMetadataFetchedAt }
                : {}),
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
            if (semanticChanged) {
              titleRefreshCandidateIds.add(state.tmdb_id);
            }
          }
          continue;
        }

        await tx
          .insert(watchlistTvStates)
          .values({
            userId,
            tmdbId: state.tmdb_id,
            lastProgress: state.last_progress,
            lastTotalAired: state.last_total_aired,
            lastWatchedCount: state.last_watched_count,
            alertActive: state.alert_active,
            alertNotifiedWatchCount: state.alert_notified_watch_count,
            alertStartedAt: state.alertStartedAt,
            alertGeneration: state.alert_generation,
            alertAcknowledgedGeneration: null,
            firstReleaseAlertState: state.first_release_alert_state ?? null,
            nextEpisodeSeason: state.next_episode_season,
            nextEpisodeNumber: state.next_episode_number,
            nextEpisodeName: state.next_episode_name,
            nextEpisodeAirDate: state.next_episode_air_date,
            lastWatchedSeason: state.last_watched_season,
            lastWatchedEpisode: state.last_watched_episode,
            checkedAt: state.checkedAt,
            tmdbMetadataFetchedAt:
              sourceMetadataFetchedAt ?? new Date(0),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              watchlistTvStates.userId,
              watchlistTvStates.tmdbId,
            ],
            set: {
              lastProgress: state.last_progress,
              lastTotalAired: state.last_total_aired,
              lastWatchedCount: state.last_watched_count,
              alertActive:
                state.alert_active && state.alert_generation
                  ? sql<boolean>`CASE
                      WHEN ${watchlistTvStates.alertAcknowledgedGeneration} = ${state.alert_generation}
                      THEN false
                      ELSE true
                    END`
                  : state.alert_active,
              alertNotifiedWatchCount: state.alert_notified_watch_count,
              alertStartedAt:
                state.alert_active && state.alert_generation
                  ? sql<Date | null>`CASE
                      WHEN ${watchlistTvStates.alertAcknowledgedGeneration} = ${state.alert_generation}
                      THEN NULL
                      ELSE ${state.alertStartedAt}
                    END`
                  : state.alertStartedAt,
              alertGeneration: state.alert_generation,
              firstReleaseAlertState:
                state.first_release_alert_state === "active" &&
                state.alert_generation
                  ? sql<string>`CASE
                      WHEN ${watchlistTvStates.alertAcknowledgedGeneration} = ${state.alert_generation}
                      THEN 'acknowledged'
                      ELSE 'active'
                    END`
                  : state.first_release_alert_state ?? null,
              nextEpisodeSeason: state.next_episode_season,
              nextEpisodeNumber: state.next_episode_number,
              nextEpisodeName: state.next_episode_name,
              nextEpisodeAirDate: state.next_episode_air_date,
              lastWatchedSeason: state.last_watched_season,
              lastWatchedEpisode: state.last_watched_episode,
              checkedAt: state.checkedAt,
              ...(sourceMetadataFetchedAt
                ? { tmdbMetadataFetchedAt: sourceMetadataFetchedAt }
                : {}),
              updatedAt: new Date(),
            },
          });
        changed = true;
        titleRefreshCandidateIds.add(state.tmdb_id);
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
    refreshCalendarMetadataInBackground(titleRefreshCandidateIds, userId);

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

