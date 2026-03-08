import {
  readTmdbCache,
  withTmdbInflight,
  writeTmdbCache,
} from "@/server/tmdb/cache";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
// TMDB API 條款允許快取，但最長不能超過 6 個月。
const CALENDAR_METADATA_TTL_MS = 150 * 24 * 60 * 60 * 1000;

type MediaType = "movie" | "tv";

type MoviePayload = {
  title?: string;
  original_title?: string;
};

type TvPayload = {
  name?: string;
  original_name?: string;
  genres?: Array<{ id: number }>;
};

export type CalendarMetadata = {
  title: string | null;
  isAnime: boolean;
};

const buildCalendarMetadataKey = (type: MediaType, id: number) =>
  `tmdb:calendar-meta:${type}:${id}`;

const buildDetailUrl = (type: MediaType, id: number, language: string) => {
  const url = new URL(`${TMDB_BASE_URL}/${type}/${id}`);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY ?? "");
  url.searchParams.set("language", language);
  return url.toString();
};

const mergeMovieMetadata = (
  primary: MoviePayload,
  fallback: MoviePayload,
): CalendarMetadata => ({
  title: primary.title || fallback.title || primary.original_title || fallback.original_title || null,
  isAnime: false,
});

const mergeTvMetadata = (
  primary: TvPayload,
  fallback: TvPayload,
): CalendarMetadata => {
  const primaryGenreIds = Array.isArray(primary.genres)
    ? primary.genres.map((genre) => genre.id)
    : [];
  const fallbackGenreIds = Array.isArray(fallback.genres)
    ? fallback.genres.map((genre) => genre.id)
    : [];
  return {
    title: primary.name || fallback.name || primary.original_name || fallback.original_name || null,
    isAnime: primaryGenreIds.includes(16) || fallbackGenreIds.includes(16),
  };
};

export const readCalendarMetadata = async (
  type: MediaType,
  id: number,
): Promise<CalendarMetadata | null> =>
  readTmdbCache<CalendarMetadata>(buildCalendarMetadataKey(type, id));

export const getCalendarMetadata = async (
  type: MediaType,
  id: number,
): Promise<CalendarMetadata | null> => {
  const cacheKey = buildCalendarMetadataKey(type, id);
  const cached = await readCalendarMetadata(type, id);
  if (cached) return cached;
  if (!process.env.TMDB_API_KEY) return null;

  try {
    const merged = await withTmdbInflight(cacheKey, async () => {
      const [primaryRes, fallbackRes] = await Promise.all([
        fetch(buildDetailUrl(type, id, "zh-TW"), { cache: "no-store" }),
        fetch(buildDetailUrl(type, id, "en-US"), { cache: "no-store" }),
      ]);

      if (!primaryRes.ok) {
        throw new Error(`TMDB calendar metadata failed:${primaryRes.status}`);
      }

      const primary = (await primaryRes.json()) as MoviePayload | TvPayload;
      const fallback = fallbackRes.ok
        ? ((await fallbackRes.json()) as MoviePayload | TvPayload)
        : {};

      return type === "movie"
        ? mergeMovieMetadata(primary as MoviePayload, fallback as MoviePayload)
        : mergeTvMetadata(primary as TvPayload, fallback as TvPayload);
    });

    await writeTmdbCache(cacheKey, merged, CALENDAR_METADATA_TTL_MS);
    return merged;
  } catch (error) {
    console.warn("calendar metadata fetch failed", { type, id, error });
    return null;
  }
};
