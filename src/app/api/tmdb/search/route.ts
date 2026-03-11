import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  readTmdbCache,
  TMDB_CACHE_KEYS,
  TMDB_CACHE_TTL,
  tmdbJson,
  withTmdbInflight,
  writeTmdbCache,
} from "@/server/tmdb/cache";

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
    fallback.map((item) => [`${item.media_type}:${item.id}`, item]),
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

const needsSearchFallback = (items: SearchItem[]) =>
  items.some(
    (item) =>
      !item.title ||
      !item.poster_path ||
      !item.overview ||
      !item.year ||
      !item.release_date,
  );

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.trim() ?? "";
  const forceRefresh = searchParams.get("refresh") === "1";

  if (!query) {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }

  if (!process.env.TMDB_API_KEY) {
    return NextResponse.json({ error: "Missing TMDB_API_KEY" }, { status: 500 });
  }

  if (forceRefresh) {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { code: "UNAUTHORIZED", message: "Not signed in" },
        { status: 401 },
      );
    }
  }

  const cacheKey = TMDB_CACHE_KEYS.search(query);
  if (!forceRefresh) {
    const cached = await readTmdbCache<{ results: SearchItem[] }>(cacheKey);
    if (cached) return tmdbJson(cached);
  }

  try {
    const payload = await withTmdbInflight(cacheKey, async () => {
      const primaryRes = await fetch(buildSearchUrl(query, "zh-TW"), {
        cache: "no-store",
      });

      if (!primaryRes.ok) {
        throw new Error(`TMDB search failed:${primaryRes.status}`);
      }

      const primaryJson = await primaryRes.json();
      const primaryItems = (primaryJson.results ?? [])
        .map(normalizeItem)
        .filter(Boolean) as SearchItem[];

      if (!needsSearchFallback(primaryItems)) {
        return { results: primaryItems };
      }

      const fallbackRes = await fetch(buildSearchUrl(query, "en-US"), {
        cache: "no-store",
      }).catch(() => null);
      const fallbackJson =
        fallbackRes && fallbackRes.ok ? await fallbackRes.json() : null;

      const fallbackItems = (fallbackJson?.results ?? [])
        .map(normalizeItem)
        .filter(Boolean) as SearchItem[];

      return { results: mergeFallback(primaryItems, fallbackItems) };
    });

    await writeTmdbCache(cacheKey, payload, TMDB_CACHE_TTL.search);
    return tmdbJson(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith("TMDB search failed:")
      ? Number(message.split(":")[1] || 502)
      : 502;
    return NextResponse.json({ error: "TMDB search failed" }, { status });
  }
}
