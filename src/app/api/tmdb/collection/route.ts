import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  readTmdbCache,
  TMDB_CACHE_KEYS,
  TMDB_CACHE_TTL,
  tmdbJson,
  withTmdbInflightGuarded,
  writeTmdbCache,
} from "@/server/tmdb/cache";
import { getOptionalTmdbUserId } from "@/server/tmdb/auth";
import { enforceTmdbProxyRateLimit } from "@/server/tmdb/rateLimit";

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
  original_title?: string;
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

const hasCjkText = (value?: string | null) =>
  Boolean(value && /[\u3400-\u9fff\uf900-\ufaff]/.test(value));

const choosePreferredLocalizedText = (
  traditional: string | null | undefined,
  originalText?: string | null | undefined,
) => {
  if (hasCjkText(traditional)) return traditional ?? null;
  return originalText || traditional || null;
};

const normalizeCollection = (payload: TMDBCollectionResponse): CollectionResponse => {
  const items = (payload.parts ?? []).map((item) => ({
    id: item.id,
    title: item.title ?? item.original_title ?? "",
    original_title: item.original_title ?? undefined,
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
  !hasCjkText(collection.name) ||
  collection.items.some(
    (item) =>
      !item.title ||
      !hasCjkText(item.title) ||
      !item.year ||
      !item.release_date ||
      !item.poster_path,
  );

const isPositiveIntegerString = (value: string | null): value is string =>
  value !== null && /^[1-9]\d*$/.test(value);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const forceRefresh = searchParams.get("refresh") === "1";

  if (!isPositiveIntegerString(id)) {
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

  const userId = forceRefresh
    ? (await auth())?.user?.id ?? null
    : await getOptionalTmdbUserId();
  if (forceRefresh) {
    if (!userId) {
      return NextResponse.json(
        { code: "UNAUTHORIZED", message: "Not signed in" },
        { status: 401 },
      );
    }
  }
  const rateLimited = enforceTmdbProxyRateLimit(request, userId, "collection");

  try {
    const merged = await withTmdbInflightGuarded(
      cacheKey,
      () => rateLimited.beforeStart(),
      async () => {
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
      const fallback = fallbackRes?.ok
        ? normalizeCollection((await fallbackRes.json()) as TMDBCollectionResponse)
        : null;
      if (!fallback) return primary;

      const fallbackMap = new Map<number, CollectionItem>();
      fallback?.items.forEach((item) => fallbackMap.set(item.id, item));

      const mergedItems = primary.items.map((item) => {
        const fallbackItem = fallbackMap.get(item.id);
        if (!fallbackItem) return item;
        return {
          ...item,
          title:
            choosePreferredLocalizedText(
              item.title,
              item.original_title,
            ) ?? "",
          year: item.year ?? fallbackItem?.year ?? null,
          release_date:
            item.release_date ??
            fallbackItem?.release_date ??
            null,
          poster_path:
            item.poster_path ??
            fallbackItem?.poster_path ??
            null,
        };
      });

      return {
        id: primary.id,
        name: choosePreferredLocalizedText(
          primary.name,
        ),
        items: mergedItems,
      } satisfies CollectionResponse;
    });

    await writeTmdbCache(cacheKey, merged, TMDB_CACHE_TTL.collection);
    return rateLimited.apply(tmdbJson(merged));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "RATE_LIMITED" && rateLimited.response) {
      return rateLimited.response;
    }
    const status = message.startsWith("TMDB collection failed:")
      ? Number(message.split(":")[1] || 502)
      : 502;
    return rateLimited.apply(
      NextResponse.json({ error: "TMDB collection failed" }, { status }),
    );
  }
}
