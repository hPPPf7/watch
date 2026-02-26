import { NextResponse } from "next/server";
import {
  readTmdbCache,
  TMDB_CACHE_KEYS,
  TMDB_CACHE_TTL,
  tmdbJson,
  withTmdbInflight,
  writeTmdbCache,
} from "@/server/tmdb/cache";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const CACHE_KEY = TMDB_CACHE_KEYS.recommendations.movie;

export const dynamic = "force-dynamic";

type MovieListItem = {
  id: number;
};

type MovieListResponse = {
  results?: MovieListItem[];
  page?: number;
  total_pages?: number;
};

const fetchMovieList = async (category: string, page = 1) => {
  const url = new URL(`${TMDB_BASE_URL}/movie/${category}`);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY ?? "");
  url.searchParams.set("language", "zh-TW");
  url.searchParams.set("include_adult", "false");
  url.searchParams.set("page", String(page));

  const response = await fetch(url.toString());
  if (!response.ok) return null;
  return (await response.json()) as MovieListResponse;
};

const fetchAnimeUntilCount = async (targetCount = 20) => {
  const collected: MovieListItem[] = [];
  let page = 1;
  let totalPages = 1;
  const maxPages = 20;

  while (collected.length < targetCount && page <= totalPages && page <= maxPages) {
    const url = new URL(`${TMDB_BASE_URL}/discover/movie`);
    url.searchParams.set("api_key", process.env.TMDB_API_KEY ?? "");
    url.searchParams.set("language", "zh-TW");
    url.searchParams.set("include_adult", "false");
    url.searchParams.set("with_genres", "16");
    url.searchParams.set("page", String(page));
    const response = await fetch(url.toString());
    if (!response.ok) break;
    const payload = (await response.json()) as MovieListResponse;
    collected.push(...(payload.results ?? []));
    totalPages = payload.total_pages ?? totalPages;
    page += 1;
  }

  return collected.slice(0, targetCount);
};

export async function GET() {
  if (!process.env.TMDB_API_KEY) {
    return NextResponse.json({ error: "Missing TMDB_API_KEY" }, { status: 500 });
  }

  const cached = await readTmdbCache<{ updated_at?: string; lists?: unknown[] }>(
    CACHE_KEY,
  );
  if (cached) {
    return tmdbJson({
      updated_at: cached.updated_at ?? new Date().toISOString(),
      lists: cached.lists ?? [],
    });
  }

  const payload = await withTmdbInflight(CACHE_KEY, async () => {
    const [nowPlaying, popular, topRated, anime] = await Promise.all([
      fetchMovieList("now_playing"),
      fetchMovieList("popular"),
      fetchMovieList("top_rated"),
      fetchAnimeUntilCount(),
    ]);
    return {
      lists: [
        { key: "popular", title: "熱門", data: popular?.results ?? [] },
        { key: "now_playing", title: "現正上映", data: nowPlaying?.results ?? [] },
        { key: "top_rated", title: "高評分", data: topRated?.results ?? [] },
        { key: "anime", title: "動畫電影", data: anime ?? [] },
      ],
    };
  });

  const responsePayload = {
    updated_at: new Date().toISOString(),
    ...payload,
  };
  await writeTmdbCache(CACHE_KEY, responsePayload, TMDB_CACHE_TTL.recommendations);
  return tmdbJson(responsePayload);
}
