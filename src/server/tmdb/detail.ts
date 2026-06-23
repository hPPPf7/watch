import {
  readTmdbCache,
  TMDB_CACHE_KEYS,
  TMDB_CACHE_TTL,
  withTmdbInflightGuarded,
  writeTmdbCache,
} from "@/server/tmdb/cache";
import { writeCalendarMetadataFromDetail } from "@/server/tmdb/calendarMetadata";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

export type DetailResponse = {
  id: number;
  media_type: "movie" | "tv";
  title: string;
  original_title?: string;
  year: string | null;
  release_date?: string | null;
  start_year: string | null;
  end_year: string | null;
  is_anime: boolean;
  collection_id?: number | null;
  collection_name?: string | null;
  collection_poster_path?: string | null;
  status?: string;
  seasons?: number | null;
  seasons_info?: Array<{ season_number: number; episode_count: number | null }>;
  runtime: number | null;
  countries: string[];
  languages: string[];
  overview: string | null;
  poster_path: string | null;
  homepage: string | null;
  original_language?: string;
};

type TMDBGenre = {
  id: number;
};

type TMDBCollectionRef = {
  id: number;
  name?: string;
  poster_path?: string | null;
};

type TMDBCountry = {
  iso_3166_1: string;
};

type TMDBLanguage = {
  iso_639_1: string;
};

type TMDBMovieDetail = {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  runtime?: number | null;
  genres?: TMDBGenre[];
  belongs_to_collection?: TMDBCollectionRef | null;
  production_countries?: TMDBCountry[];
  spoken_languages?: TMDBLanguage[];
  overview?: string | null;
  poster_path?: string | null;
  homepage?: string | null;
  original_language?: string;
};

type TMDBTvDetail = {
  id: number;
  name?: string;
  original_name?: string;
  first_air_date?: string;
  last_air_date?: string;
  status?: string;
  number_of_seasons?: number | null;
  seasons?: Array<{ season_number?: number; episode_count?: number | null }>;
  episode_run_time?: number[];
  genres?: TMDBGenre[];
  origin_country?: string[];
  spoken_languages?: TMDBLanguage[];
  overview?: string | null;
  poster_path?: string | null;
  homepage?: string | null;
  original_language?: string;
};

type TMDBDetail = TMDBMovieDetail | TMDBTvDetail;

const buildDetailUrl = (type: "movie" | "tv", id: string, language: string) => {
  const url = new URL(`${TMDB_BASE_URL}/${type}/${id}`);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY ?? "");
  url.searchParams.set("language", language);
  return url.toString();
};

const extractYear = (dateValue?: string) => {
  if (!dateValue) return null;
  return dateValue.slice(0, 4) || null;
};

const hasCjkText = (value?: string | null) =>
  Boolean(value && /[\u3400-\u9fff\uf900-\ufaff]/.test(value));

const isChineseLanguage = (value?: string | null) =>
  Boolean(value && value.toLowerCase().startsWith("zh"));

const isOriginalTitleFallback = (
  title: string | null | undefined,
  originalTitle: string | null | undefined,
  originalLanguage: string | null | undefined,
) =>
  Boolean(
    title?.trim() &&
      originalTitle?.trim() &&
      title.trim() === originalTitle.trim() &&
      !isChineseLanguage(originalLanguage),
  );

const hasLocalizedTitle = (
  title: string | null | undefined,
  originalTitle: string | null | undefined,
  originalLanguage: string | null | undefined,
) => {
  const normalizedTitle = title?.trim();
  if (!normalizedTitle) return false;

  const normalizedOriginalTitle = originalTitle?.trim();
  if (!normalizedOriginalTitle) return hasCjkText(normalizedTitle);
  if (normalizedTitle !== normalizedOriginalTitle) return true;
  return isChineseLanguage(originalLanguage);
};

const choosePreferredLocalizedText = (
  traditional: string | null | undefined,
  simplified: string | null | undefined,
  originalText?: string | null | undefined,
) => {
  if (hasCjkText(traditional)) return traditional ?? null;
  if (hasCjkText(simplified)) return simplified ?? null;
  return originalText || traditional || simplified || null;
};

const choosePreferredTitle = (
  traditional: string | null | undefined,
  simplified: string | null | undefined,
  originalTitle: string | null | undefined,
  originalLanguage: string | null | undefined,
) => {
  if (hasLocalizedTitle(traditional, originalTitle, originalLanguage)) {
    return { title: traditional ?? null, titleRefreshReason: undefined };
  }
  if (hasLocalizedTitle(simplified, originalTitle, originalLanguage)) {
    return {
      title: simplified ?? null,
      titleRefreshReason: "simplified" as const,
    };
  }
  return {
    title: originalTitle || traditional || simplified || null,
    titleRefreshReason: isChineseLanguage(originalLanguage)
      ? undefined
      : ("missing" as const),
  };
};

type DetailFetchResult = {
  primaryRes: Response;
  simplifiedRes: Response | null;
  fallbackRes: Response | null;
};

async function fetchWithOptionalFallback(
  primaryUrl: string,
  simplifiedUrl: string,
  fallbackUrl: string,
  needsFallback: (primary: DetailResponse) => boolean,
  type: "movie" | "tv",
): Promise<DetailFetchResult & { primary: DetailResponse }> {
  const primaryRes = await fetch(primaryUrl, { cache: "no-store" });
  if (!primaryRes.ok) {
    return {
      primaryRes,
      simplifiedRes: null,
      fallbackRes: null,
      primary: null as never,
    };
  }

  const primary =
    type === "movie"
      ? normalizeDetail("movie", await primaryRes.json())
      : normalizeDetail("tv", await primaryRes.json());

  if (!needsFallback(primary)) {
    return {
      primaryRes,
      simplifiedRes: null,
      fallbackRes: null,
      primary,
    };
  }

  const [simplifiedRes, fallbackRes] = await Promise.all([
    fetch(simplifiedUrl, { cache: "no-store" }).catch(() => null),
    fetch(fallbackUrl, { cache: "no-store" }).catch(() => null),
  ]);

  return {
    primaryRes,
    simplifiedRes,
    fallbackRes,
    primary,
  };
}

const isTvPreReleaseStatus = (status?: string | null) =>
  Boolean(
    status &&
      ["planned", "in production", "post production"].includes(
        status.toLowerCase(),
      ),
  );

const needsDetailFallback = (detail: DetailResponse) =>
  !detail.title ||
  !hasCjkText(detail.title) ||
  isOriginalTitleFallback(
    detail.title,
    detail.original_title,
    detail.original_language,
  ) ||
  !detail.poster_path ||
  !detail.overview ||
  !hasCjkText(detail.overview) ||
  !detail.runtime ||
  !detail.homepage ||
  !detail.original_title ||
  !detail.original_language ||
  detail.languages.length === 0 ||
  detail.countries.length === 0 ||
  (detail.media_type === "movie" &&
    (!!detail.collection_id &&
      (!detail.collection_name ||
        !hasCjkText(detail.collection_name) ||
        !detail.collection_poster_path))) ||
  (detail.media_type === "tv" &&
    (((!isTvPreReleaseStatus(detail.status)) &&
      !detail.release_date) ||
      !detail.seasons_info ||
      detail.seasons_info.length === 0));

function normalizeDetail(type: "movie", item: TMDBMovieDetail): DetailResponse;
function normalizeDetail(type: "tv", item: TMDBTvDetail): DetailResponse;
function normalizeDetail(type: "movie" | "tv", item: TMDBDetail): DetailResponse {
  if (type === "movie") {
    const movie = item as TMDBMovieDetail;
    const year = extractYear(movie.release_date);
    return {
      id: movie.id,
      media_type: "movie",
      title: movie.title ?? "",
      original_title: movie.original_title ?? undefined,
      year,
      release_date: movie.release_date || null,
      start_year: year,
      end_year: year,
      is_anime: false,
      collection_id: movie.belongs_to_collection?.id ?? null,
      collection_name: movie.belongs_to_collection?.name ?? null,
      collection_poster_path: movie.belongs_to_collection?.poster_path ?? null,
      runtime: movie.runtime ?? null,
      countries: (movie.production_countries ?? []).map(
        (country: TMDBCountry) => country.iso_3166_1,
      ),
      languages: (movie.spoken_languages ?? []).map(
        (language: TMDBLanguage) => language.iso_639_1,
      ),
      overview: movie.overview ?? null,
      poster_path: movie.poster_path ?? null,
      homepage: movie.homepage ?? null,
      original_language: movie.original_language ?? undefined,
    };
  }

  const tv = item as TMDBTvDetail;
  const year = extractYear(tv.first_air_date);
  const startYear = extractYear(tv.first_air_date);
  const endYear = extractYear(tv.last_air_date);
  const runtime =
    Array.isArray(tv.episode_run_time) && tv.episode_run_time.length > 0
      ? tv.episode_run_time[0]
      : null;
  const genreIds = Array.isArray(tv.genres) ? tv.genres.map((genre) => genre.id) : [];
  const seasonsInfo = Array.isArray(tv.seasons)
    ? tv.seasons
        .filter((season: { season_number?: number }) => (season.season_number ?? 0) > 0)
        .map((season: { season_number?: number; episode_count?: number | null }) => ({
          season_number: season.season_number ?? 0,
          episode_count: season.episode_count ?? null,
        }))
    : undefined;
  const seasonsCount = Array.isArray(tv.seasons)
    ? tv.seasons.filter((season: { season_number?: number }) => (season.season_number ?? 0) > 0).length
    : tv.number_of_seasons ?? null;

  return {
    id: tv.id,
    media_type: "tv",
    title: tv.name ?? "",
    original_title: tv.original_name ?? undefined,
    year,
    release_date: tv.first_air_date || null,
    start_year: startYear,
    end_year: endYear,
    is_anime: genreIds.includes(16),
    status: tv.status ?? undefined,
    seasons: seasonsCount,
    seasons_info: seasonsInfo,
    runtime,
    countries: tv.origin_country ?? [],
    languages: (tv.spoken_languages ?? []).map(
      (language: TMDBLanguage) => language.iso_639_1,
    ),
    overview: tv.overview ?? null,
    poster_path: tv.poster_path ?? null,
    homepage: tv.homepage ?? null,
    original_language: tv.original_language ?? undefined,
  };
}

export async function getTmdbDetail(
  type: "movie" | "tv",
  id: string,
  options?: { forceRefresh?: boolean; beforeStart?: () => Promise<void> | void }
) {
  if (!process.env.TMDB_API_KEY) {
    throw new Error("TMDB_API_KEY_MISSING");
  }

  const forceRefresh = options?.forceRefresh === true;
  const cacheKey = TMDB_CACHE_KEYS.detail(type, id);
  if (!forceRefresh) {
    const cached = await readTmdbCache<DetailResponse>(cacheKey);
    if (cached) return cached;
  }

  const fetched = await withTmdbInflightGuarded(cacheKey, () => options?.beforeStart?.(), async () => {
    const { primaryRes, simplifiedRes, fallbackRes, primary } = await fetchWithOptionalFallback(
      buildDetailUrl(type, id, "zh-TW"),
      buildDetailUrl(type, id, "zh-CN"),
      buildDetailUrl(type, id, "en-US"),
      needsDetailFallback,
      type,
    );

    if (!primaryRes.ok) {
      throw new Error(`TMDB detail failed:${primaryRes.status}`);
    }
    if (!simplifiedRes?.ok && !fallbackRes?.ok) {
      const preferredTitle = choosePreferredTitle(
        primary.title,
        null,
        primary.original_title,
        primary.original_language,
      );
      return {
        detail: primary,
        titleRefreshReason: preferredTitle.titleRefreshReason,
      };
    }

    const simplified =
      simplifiedRes?.ok
        ? type === "movie"
          ? normalizeDetail("movie", await simplifiedRes.json())
          : normalizeDetail("tv", await simplifiedRes.json())
        : null;
    const fallback =
      type === "movie"
        ? fallbackRes?.ok
          ? normalizeDetail("movie", await fallbackRes.json())
          : null
        : fallbackRes?.ok
          ? normalizeDetail("tv", await fallbackRes.json())
          : null;
    const preferredTitle = choosePreferredTitle(
      primary.title,
      simplified?.title,
      primary.original_title,
      primary.original_language,
    );

    return {
      detail: {
      ...primary,
      title: preferredTitle.title ?? "",
      original_title:
        primary.original_title ?? simplified?.original_title ?? fallback?.original_title,
      year: primary.year ?? simplified?.year ?? fallback?.year ?? null,
      release_date:
        primary.release_date || simplified?.release_date || fallback?.release_date,
      status: primary.status ?? simplified?.status ?? fallback?.status,
      start_year:
        primary.start_year ?? simplified?.start_year ?? fallback?.start_year ?? null,
      end_year: primary.end_year ?? simplified?.end_year ?? fallback?.end_year ?? null,
      is_anime: primary.is_anime || Boolean(simplified?.is_anime) || Boolean(fallback?.is_anime),
      collection_id:
        primary.collection_id ?? simplified?.collection_id ?? fallback?.collection_id,
      collection_name:
        choosePreferredLocalizedText(
          primary.collection_name,
          simplified?.collection_name,
        ),
      collection_poster_path:
        primary.collection_poster_path ??
        simplified?.collection_poster_path ??
        fallback?.collection_poster_path,
      runtime: primary.runtime ?? simplified?.runtime ?? fallback?.runtime ?? null,
      countries: primary.countries.length
        ? primary.countries
        : simplified?.countries.length
          ? simplified.countries
          : fallback?.countries ?? [],
      languages: primary.languages.length
        ? primary.languages
        : simplified?.languages.length
          ? simplified.languages
          : fallback?.languages ?? [],
      overview: choosePreferredLocalizedText(
        primary.overview,
        simplified?.overview,
      ),
      poster_path: primary.poster_path ?? simplified?.poster_path ?? fallback?.poster_path ?? null,
      homepage: primary.homepage ?? simplified?.homepage ?? fallback?.homepage ?? null,
      original_language:
        primary.original_language ?? simplified?.original_language ?? fallback?.original_language,
      seasons_info: primary.seasons_info ?? simplified?.seasons_info ?? fallback?.seasons_info,
      } satisfies DetailResponse,
      titleRefreshReason: preferredTitle.titleRefreshReason,
    };
  });

  await writeTmdbCache(cacheKey, fetched.detail, TMDB_CACHE_TTL.detail);
  await writeCalendarMetadataFromDetail(type, Number(id), fetched.detail, {
    titleRefreshReason: fetched.titleRefreshReason,
  });
  return fetched.detail;
}
