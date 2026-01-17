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

const normalizeDetail = (type: "movie" | "tv", item: TMDBDetail): DetailResponse => {
  const title = type === "movie" ? item.title : item.name;
  const originalTitle =
    type === "movie" ? item.original_title : item.original_name;
  const dateValue =
    type === "movie" ? item.release_date : item.first_air_date;
  const year = extractYear(dateValue);
  const startYear =
    type === "tv" ? extractYear(item.first_air_date) : year;
  const endYear =
    type === "tv" ? extractYear(item.last_air_date) : year;
  const runtime =
    type === "movie"
      ? item.runtime ?? null
      : Array.isArray(item.episode_run_time) && item.episode_run_time.length > 0
      ? item.episode_run_time[0]
      : null;
  const genreIds = Array.isArray(item.genres)
    ? item.genres.map((genre) => genre.id)
    : [];
  const isAnime = type === "tv" && genreIds.includes(16);
  const countries =
    type === "movie"
      ? (item.production_countries ?? []).map((c) => c.iso_3166_1)
      : item.origin_country ?? [];
  const languages = (item.spoken_languages ?? []).map(
    (lang) => lang.iso_639_1
  );

  return {
    id: item.id,
    media_type: type,
    title: title ?? "",
    original_title: originalTitle ?? undefined,
    year,
    start_year: startYear,
    end_year: endYear,
    is_anime: isAnime,
    runtime,
    countries,
    languages,
    overview: item.overview ?? null,
    poster_path: item.poster_path ?? null,
    homepage: item.homepage ?? null,
    original_language: item.original_language ?? undefined,
  };
};

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

  const primary = normalizeDetail(type, await primaryRes.json());
  if (!fallbackRes.ok) {
    return NextResponse.json(primary);
  }

  const fallback = normalizeDetail(type, await fallbackRes.json());

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
  };

  return NextResponse.json(merged);
}
