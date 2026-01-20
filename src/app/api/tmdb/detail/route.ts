import { NextResponse } from "next/server";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

type DetailResponse = {
  id: number;
  media_type: "movie" | "tv";
  title: string;
  original_title?: string;
  year: string | null;
  start_year: string | null;
  end_year: string | null;
  is_anime: boolean;
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

const buildDetailUrl = (type: string, id: string, language: string) => {
  const url = new URL(`${TMDB_BASE_URL}/${type}/${id}`);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY ?? "");
  url.searchParams.set("language", language);
  return url.toString();
};

const extractYear = (dateValue?: string) => {
  if (!dateValue) return null;
  return dateValue.slice(0, 4) || null;
};

function normalizeDetail(type: "movie", item: TMDBMovieDetail): DetailResponse;
function normalizeDetail(type: "tv", item: TMDBTvDetail): DetailResponse;
function normalizeDetail(
  type: "movie" | "tv",
  item: TMDBDetail
): DetailResponse {
  if (type === "movie") {
    const movie = item as TMDBMovieDetail;
    const year = extractYear(movie.release_date);
    return {
      id: movie.id,
      media_type: "movie",
      title: movie.title ?? "",
      original_title: movie.original_title ?? undefined,
      year,
      start_year: year,
      end_year: year,
      is_anime: false,
      runtime: movie.runtime ?? null,
      countries: (movie.production_countries ?? []).map(
        (c: TMDBCountry) => c.iso_3166_1
      ),
      languages: (movie.spoken_languages ?? []).map(
        (lang: TMDBLanguage) => lang.iso_639_1
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
  const genreIds = Array.isArray(tv.genres)
    ? tv.genres.map((genre) => genre.id)
    : [];
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
    start_year: startYear,
    end_year: endYear,
    is_anime: genreIds.includes(16),
    status: tv.status ?? undefined,
    seasons: seasonsCount,
    seasons_info: seasonsInfo,
    runtime,
    countries: tv.origin_country ?? [],
    languages: (tv.spoken_languages ?? []).map(
      (lang: TMDBLanguage) => lang.iso_639_1
    ),
    overview: tv.overview ?? null,
    poster_path: tv.poster_path ?? null,
    homepage: tv.homepage ?? null,
    original_language: tv.original_language ?? undefined,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const type = searchParams.get("type");

  if (!id || (type !== "movie" && type !== "tv")) {
    return NextResponse.json(
      { error: "Missing or invalid parameters" },
      { status: 400 }
    );
  }

  if (!process.env.TMDB_API_KEY) {
    return NextResponse.json({ error: "Missing TMDB_API_KEY" }, { status: 500 });
  }

  const [primaryRes, fallbackRes] = await Promise.all([
    fetch(buildDetailUrl(type, id, "zh-TW"), { cache: "no-store" }),
    fetch(buildDetailUrl(type, id, "en-US"), { cache: "no-store" }),
  ]);

  if (!primaryRes.ok) {
    return NextResponse.json(
      { error: "TMDB detail failed" },
      { status: primaryRes.status }
    );
  }

  const primary =
    type === "movie"
      ? normalizeDetail("movie", await primaryRes.json())
      : normalizeDetail("tv", await primaryRes.json());
  if (!fallbackRes.ok) {
    return NextResponse.json(primary);
  }

  const fallback =
    type === "movie"
      ? normalizeDetail("movie", await fallbackRes.json())
      : normalizeDetail("tv", await fallbackRes.json());

  const merged: DetailResponse = {
    ...primary,
    title: primary.title || fallback.title,
    original_title: primary.original_title ?? fallback.original_title,
    year: primary.year ?? fallback.year,
    start_year: primary.start_year ?? fallback.start_year,
    end_year: primary.end_year ?? fallback.end_year,
    is_anime: primary.is_anime || fallback.is_anime,
    runtime: primary.runtime ?? fallback.runtime,
    countries: primary.countries.length ? primary.countries : fallback.countries,
    languages: primary.languages.length ? primary.languages : fallback.languages,
    overview: primary.overview ?? fallback.overview,
    poster_path: primary.poster_path ?? fallback.poster_path,
    homepage: primary.homepage ?? fallback.homepage,
    original_language: primary.original_language ?? fallback.original_language,
    seasons_info: primary.seasons_info ?? fallback.seasons_info,
  };

  return NextResponse.json(merged);
}
