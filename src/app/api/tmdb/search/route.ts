import { NextResponse } from "next/server";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

type SearchItem = {
  id: number;
  media_type: "movie" | "tv";
  title: string;
  original_title?: string;
  year: string | null;
  release_date: string | null;
  is_anime: boolean;
  poster_path: string | null;
  overview: string | null;
  original_language?: string;
};

const buildSearchUrl = (query: string, language: string) => {
  const url = new URL(`${TMDB_BASE_URL}/search/multi`);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY ?? "");
  url.searchParams.set("query", query);
  url.searchParams.set("language", language);
  url.searchParams.set("include_adult", "false");
  return url.toString();
};

type SearchApiItem = {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  genre_ids?: number[];
  poster_path?: string | null;
  overview?: string | null;
  original_title?: string;
  original_name?: string;
  original_language?: string;
};

const normalizeItem = (item: SearchApiItem): SearchItem | null => {
  if (item.media_type !== "movie" && item.media_type !== "tv") return null;

  const title = item.title ?? item.name ?? "";
  const releaseDate = item.release_date ?? item.first_air_date ?? "";
  const year = releaseDate ? releaseDate.slice(0, 4) : null;

  const genreIds = Array.isArray(item.genre_ids) ? item.genre_ids : [];
  const isAnime = item.media_type === "tv" && genreIds.includes(16);

  return {
    id: item.id,
    media_type: item.media_type,
    title,
    original_title: item.original_title ?? item.original_name ?? undefined,
    year,
    release_date: releaseDate || null,
    is_anime: isAnime,
    poster_path: item.poster_path ?? null,
    overview: item.overview ?? null,
    original_language: item.original_language ?? undefined,
  };
};

const mergeFallback = (primary: SearchItem[], fallback: SearchItem[]) => {
  const fallbackMap = new Map(
    fallback.map((item) => [`${item.media_type}:${item.id}`, item])
  );

  return primary.map((item) => {
    const key = `${item.media_type}:${item.id}`;
    const fallbackItem = fallbackMap.get(key);
    if (!fallbackItem) return item;

    return {
      ...item,
      title: item.title || fallbackItem.title,
      original_title: item.original_title ?? fallbackItem.original_title,
      year: item.year ?? fallbackItem.year,
      release_date: item.release_date ?? fallbackItem.release_date,
      poster_path: item.poster_path ?? fallbackItem.poster_path,
      overview: item.overview ?? fallbackItem.overview,
    };
  });
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.trim() ?? "";

  if (!query) {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }

  if (!process.env.TMDB_API_KEY) {
    return NextResponse.json({ error: "Missing TMDB_API_KEY" }, { status: 500 });
  }

  const [primaryRes, fallbackRes] = await Promise.all([
    fetch(buildSearchUrl(query, "zh-TW"), { cache: "no-store" }),
    fetch(buildSearchUrl(query, "en-US"), { cache: "no-store" }),
  ]);

  if (!primaryRes.ok) {
    return NextResponse.json(
      { error: "TMDB search failed" },
      { status: primaryRes.status }
    );
  }

  const primaryJson = await primaryRes.json();
  const fallbackJson = fallbackRes.ok ? await fallbackRes.json() : null;

  const primaryItems = (primaryJson.results ?? [])
    .map(normalizeItem)
    .filter(Boolean) as SearchItem[];

  const fallbackItems = (fallbackJson?.results ?? [])
    .map(normalizeItem)
    .filter(Boolean) as SearchItem[];

  const merged = mergeFallback(primaryItems, fallbackItems);

  return NextResponse.json({ results: merged });
}
