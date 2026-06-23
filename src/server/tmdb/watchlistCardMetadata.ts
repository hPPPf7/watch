import {
  readManyTmdbCacheIncludingExpired,
  TMDB_CACHE_KEYS,
} from "@/server/tmdb/cache";
import { buildCalendarMetadataKey } from "@/server/tmdb/calendarMetadata";

type MediaType = "movie" | "tv";

type CachedDetail = {
  title?: string;
  year?: string | null;
  release_date?: string | null;
  status?: string | null;
  poster_path?: string | null;
  is_anime?: boolean;
};

type CachedCalendarMetadata = {
  title?: string | null;
  isAnime?: boolean;
};

export type WatchlistCardMetadata = {
  title: string;
  year: string | null;
  releaseDate: string | null;
  status: string | null;
  posterPath: string | null;
  isAnime?: boolean;
  cachedAt: string | null;
  isStale: boolean;
};

type WatchlistMetadataRequest = {
  type: MediaType;
  tmdbId: number;
};

const buildFallbackMetadata = (tmdbId: number): WatchlistCardMetadata => ({
  title: `TMDB ${tmdbId}`,
  year: null,
  releaseDate: null,
  status: null,
  posterPath: null,
  isAnime: undefined,
  cachedAt: null,
  isStale: true,
});

export const getWatchlistCardMetadataBatch = async (
  requests: WatchlistMetadataRequest[],
): Promise<Map<string, WatchlistCardMetadata>> => {
  const detailKeys = requests.map(({ type, tmdbId }) =>
    TMDB_CACHE_KEYS.detail(type, String(tmdbId)),
  );
  const calendarKeys = requests.map(
    ({ type, tmdbId }) => buildCalendarMetadataKey(type, tmdbId),
  );
  const [cachedDetailEntries, cachedCalendarEntries] = await Promise.all([
    readManyTmdbCacheIncludingExpired<CachedDetail>(detailKeys),
    readManyTmdbCacheIncludingExpired<CachedCalendarMetadata>(calendarKeys),
  ]);
  const result = new Map<string, WatchlistCardMetadata>();

  requests.forEach(({ type, tmdbId }) => {
    const requestKey = `${type}:${tmdbId}`;
    const detailCacheKey = TMDB_CACHE_KEYS.detail(type, String(tmdbId));
    const calendarCacheKey = buildCalendarMetadataKey(type, tmdbId);
    const cachedDetail = cachedDetailEntries.get(detailCacheKey);
    const cachedCalendar = cachedCalendarEntries.get(calendarCacheKey);
    const detailPayload = cachedDetail?.payload;
    const calendarPayload = cachedCalendar?.payload;
    const detailUpdatedAt = cachedDetail?.updatedAt
      ? new Date(cachedDetail.updatedAt).getTime()
      : 0;
    const calendarUpdatedAt = cachedCalendar?.updatedAt
      ? new Date(cachedCalendar.updatedAt).getTime()
      : 0;
    const preferredTitle =
      calendarPayload?.title?.trim() &&
      calendarUpdatedAt >= detailUpdatedAt
        ? calendarPayload.title.trim()
        : detailPayload?.title?.trim() || calendarPayload?.title?.trim() || `TMDB ${tmdbId}`;

    result.set(requestKey, {
      title: preferredTitle,
      year: detailPayload?.year ?? null,
      releaseDate: detailPayload?.release_date ?? null,
      status: detailPayload?.status ?? null,
      posterPath: detailPayload?.poster_path ?? null,
      isAnime: detailPayload?.is_anime ?? calendarPayload?.isAnime,
      cachedAt: cachedDetail?.updatedAt
        ? new Date(cachedDetail.updatedAt).toISOString()
        : cachedCalendar?.updatedAt
          ? new Date(cachedCalendar.updatedAt).toISOString()
          : null,
      isStale: cachedDetail?.expired ?? true,
    });
  });

  return result;
};

export const getWatchlistCardMetadata = async (
  type: MediaType,
  tmdbId: number,
): Promise<WatchlistCardMetadata> => {
  const result = await getWatchlistCardMetadataBatch([{ type, tmdbId }]);
  return result.get(`${type}:${tmdbId}`) ?? buildFallbackMetadata(tmdbId);
};
