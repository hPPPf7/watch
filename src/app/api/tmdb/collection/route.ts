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

type TMDBCollectionItem = {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  poster_path?: string | null;
};

type TMDBCollectionResponse = {
  id: number;
  name?: string;
  parts?: TMDBCollectionItem[];
};

type CollectionItem = {
  id: number;
  title: string;
  year: string | null;
  release_date: string | null;
  poster_path: string | null;
};

type CollectionResponse = {
  id: number;
  name: string | null;
  items: CollectionItem[];
};

const buildCollectionUrl = (id: string, language: string) => {
  const url = new URL(`${TMDB_BASE_URL}/collection/${id}`);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY ?? "");
  url.searchParams.set("language", language);
  return url.toString();
};

const extractYear = (dateValue?: string) => {
  if (!dateValue) return null;
  return dateValue.slice(0, 4) || null;
};

const normalizeCollection = (payload: TMDBCollectionResponse): CollectionResponse => {
  const items = (payload.parts ?? []).map((item) => ({
    id: item.id,
    title: item.title ?? item.original_title ?? "",
    year: extractYear(item.release_date),
    release_date: item.release_date ?? null,
    poster_path: item.poster_path ?? null,
  }));

  const sortedItems = items.slice().sort((a, b) => {
    const aYear = a.year ? Number(a.year) : 9999;
    const bYear = b.year ? Number(b.year) : 9999;
    if (aYear !== bYear) return aYear - bYear;
    return a.id - b.id;
  });

  return {
    id: payload.id,
    name: payload.name ?? null,
    items: sortedItems,
  };
};

const needsCollectionFallback = (collection: CollectionResponse) =>
  !collection.name ||
  collection.items.some(
    (item) => !item.title || !item.year || !item.release_date || !item.poster_path,
  );

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const forceRefresh = searchParams.get("refresh") === "1";

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  if (!process.env.TMDB_API_KEY) {
    return NextResponse.json({ error: "Missing TMDB_API_KEY" }, { status: 500 });
  }

  const cacheKey = TMDB_CACHE_KEYS.collection(id);
  if (!forceRefresh) {
    const cached = await readTmdbCache<CollectionResponse>(cacheKey);
    if (cached) return tmdbJson(cached);
  }

  try {
    const merged = await withTmdbInflight(cacheKey, async () => {
      const primaryRes = await fetch(buildCollectionUrl(id, "zh-TW"), {
        cache: "no-store",
      });

      if (!primaryRes.ok) {
        throw new Error(`TMDB collection failed:${primaryRes.status}`);
      }

      const primary = normalizeCollection(
        (await primaryRes.json()) as TMDBCollectionResponse,
      );
      if (!needsCollectionFallback(primary)) return primary;

      const fallbackRes = await fetch(buildCollectionUrl(id, "en-US"), {
        cache: "no-store",
      }).catch(() => null);
      if (!fallbackRes?.ok) return primary;

      const fallback = normalizeCollection(
        (await fallbackRes.json()) as TMDBCollectionResponse,
      );

      const fallbackMap = new Map<number, CollectionItem>();
      fallback.items.forEach((item) => fallbackMap.set(item.id, item));

      const mergedItems = primary.items.map((item) => {
        if (item.title && item.year && item.release_date && item.poster_path) return item;
        const fallbackItem = fallbackMap.get(item.id);
        if (!fallbackItem) return item;
        return {
          ...item,
          title: item.title || fallbackItem.title,
          year: item.year ?? fallbackItem.year,
          release_date: item.release_date ?? fallbackItem.release_date,
          poster_path: item.poster_path ?? fallbackItem.poster_path,
        };
      });

      return {
        id: primary.id,
        name: primary.name ?? fallback.name,
        items: mergedItems,
      } satisfies CollectionResponse;
    });

    await writeTmdbCache(cacheKey, merged, TMDB_CACHE_TTL.collection);
    return tmdbJson(merged);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith("TMDB collection failed:")
      ? Number(message.split(":")[1] || 502)
      : 502;
    return NextResponse.json({ error: "TMDB collection failed" }, { status });
  }
}
