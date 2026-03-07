import { readManyTmdbCache, TMDB_CACHE_KEYS } from "@/server/tmdb/cache";

type MediaType = "movie" | "tv";

type CachedDetail = {
  title?: string;
  year?: string | null;
  release_date?: string | null;
  poster_path?: string | null;
  is_anime?: boolean;
};

export type WatchlistCardMetadata = {
  title: string;
  year: string | null;
  releaseDate: string | null;
  posterPath: string | null;
  isAnime?: boolean;
  cachedAt: string | null;
};

type WatchlistMetadataRequest = {
  type: MediaType;
  tmdbId: number;
};

const buildFallbackMetadata = (tmdbId: number): WatchlistCardMetadata => ({
  title: `TMDB ${tmdbId}`,
  year: null,
  releaseDate: null,
  posterPath: null,
  isAnime: undefined,
  cachedAt: null,
});

export const getWatchlistCardMetadataBatch = async (
  requests: WatchlistMetadataRequest[],
): Promise<Map<string, WatchlistCardMetadata>> => {
  const keys = requests.map(({ type, tmdbId }) =>
    TMDB_CACHE_KEYS.detail(type, String(tmdbId)),
  );
  const cachedEntries = await readManyTmdbCache<CachedDetail>(keys);
  const result = new Map<string, WatchlistCardMetadata>();

  requests.forEach(({ type, tmdbId }) => {
    const requestKey = `${type}:${tmdbId}`;
    const cacheKey = TMDB_CACHE_KEYS.detail(type, String(tmdbId));
    const cached = cachedEntries.get(cacheKey);
    const payload = cached?.payload;
    result.set(requestKey, {
      title: payload?.title?.trim() || `TMDB ${tmdbId}`,
      year: payload?.year ?? null,
      releaseDate: payload?.release_date ?? null,
      posterPath: payload?.poster_path ?? null,
      isAnime: payload?.is_anime,
      cachedAt: cached?.updatedAt ? new Date(cached.updatedAt).toISOString() : null,
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
