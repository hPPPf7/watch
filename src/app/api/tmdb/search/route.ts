import { fetchTmdbWithCooldown, tmdbRetryAfterSeconds } from "@/server/tmdb/fetchWithCooldown";
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
const MAX_SEARCH_PAGE = 500;

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

type SearchPayload = {
  results: SearchItem[];
  page: number;
  total_pages: number;
};

const buildSearchUrl = (query: string, language: string, page: number) => {
  const url = new URL(`${TMDB_BASE_URL}/search/multi`);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY ?? "");
  url.searchParams.set("query", query);
  url.searchParams.set("language", language);
  url.searchParams.set("page", String(page));
  url.searchParams.set("include_adult", "false");
  return url.toString();
};

type SearchApiItem = {
  id: number;
  media_type: "movie" | "tv" | "person";
  title?: string | null;
  name?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
  genre_ids?: number[];
  poster_path?: string | null;
  overview?: string | null;
  original_title?: string | null;
  original_name?: string | null;
  original_language?: string | null;
};

const isSearchApiItem = (value: unknown): value is SearchApiItem => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (!Number.isSafeInteger(item.id) || (item.id as number) <= 0) return false;
  if (!["movie", "tv", "person"].includes(item.media_type as string)) return false;
  const textFields = [
    "title", "name", "release_date", "first_air_date", "poster_path", "overview",
    "original_title", "original_name", "original_language",
  ];
  if (textFields.some((field) => item[field] != null && typeof item[field] !== "string")) {
    return false;
  }
  return item.genre_ids === undefined || (
    Array.isArray(item.genre_ids) && item.genre_ids.every((id) => Number.isSafeInteger(id))
  );
};

const parseSearchResponse = (value: unknown, requestedPage: number) => {
  if (!value || typeof value !== "object") throw new Error("Invalid TMDB search response");
  const payload = value as Record<string, unknown>;
  if (
    payload.page !== requestedPage ||
    !Number.isSafeInteger(payload.total_pages) ||
    (payload.total_pages as number) < 0 ||
    !Array.isArray(payload.results) ||
    !payload.results.every(isSearchApiItem) ||
    (payload.total_pages === 0 && payload.results.length > 0)
  ) {
    throw new Error("Invalid TMDB search response");
  }
  return {
    results: payload.results as SearchApiItem[],
    page: requestedPage,
    total_pages: Math.min(payload.total_pages as number, MAX_SEARCH_PAGE),
  };
};

const hasCjkText = (value?: string | null) =>
  Boolean(value && /[\u3400-\u9fff\uf900-\ufaff]/.test(value));

const choosePreferredLocalizedText = (
  traditional: string | null | undefined,
  originalText?: string | null,
) => {
  if (hasCjkText(traditional)) return traditional ?? null;
  return originalText || traditional || null;
};

const normalizeItem = (item: SearchApiItem): SearchItem | null => {
  if (item.media_type !== "movie" && item.media_type !== "tv") return null;

  const originalTitle = item.original_title ?? item.original_name ?? undefined;
  // Text selection must work even when the optional metadata lookup fails or is skipped.
  const title = choosePreferredLocalizedText(item.title ?? item.name, originalTitle) ?? "";
  const releaseDate = item.release_date ?? item.first_air_date ?? "";
  const year = releaseDate ? releaseDate.slice(0, 4) : null;
  const genreIds = item.genre_ids ?? [];

  return {
    id: item.id,
    media_type: item.media_type,
    title,
    original_title: originalTitle,
    year,
    release_date: releaseDate || null,
    is_anime: item.media_type === "tv" && genreIds.includes(16),
    poster_path: item.poster_path || null,
    overview: item.overview || null,
    original_language: item.original_language ?? undefined,
  };
};

const normalizeItems = (items: SearchApiItem[]) =>
  items.map(normalizeItem).filter((item): item is SearchItem => item !== null);

const mergeFallback = (primary: SearchItem[], fallback: SearchItem[]) => {
  const fallbackMap = new Map(
    fallback.map((item) => [`${item.media_type}:${item.id}`, item]),
  );

  return primary.map((item) => {
    const fallbackItem = fallbackMap.get(`${item.media_type}:${item.id}`);
    if (!fallbackItem) return item;

    return {
      ...item,
      year: item.year ?? fallbackItem.year,
      release_date: item.release_date ?? fallbackItem.release_date,
      poster_path: item.poster_path ?? fallbackItem.poster_path,
    };
  });
};

const needsSearchFallback = (items: SearchItem[]) =>
  items.some((item) => !item.poster_path || !item.release_date);

const fetchSearch = async (query: string, page: number): Promise<SearchPayload> => {
  const primaryRes = await fetchTmdbWithCooldown(buildSearchUrl(query, "zh-TW", page), {
    cache: "no-store",
  });

  if (!primaryRes.ok) {
    throw new Error(`TMDB search failed:${primaryRes.status}`);
  }

  const primary = parseSearchResponse(await primaryRes.json(), page);
  const primaryItems = normalizeItems(primary.results);
  const payload = { ...primary, results: primaryItems };
  if (!needsSearchFallback(primaryItems)) return payload;

  // en-US is optional and may only fill non-text metadata for matching primary hits.
  try {
    const fallbackRes = await fetchTmdbWithCooldown(buildSearchUrl(query, "en-US", page), {
      cache: "no-store",
    });
    if (!fallbackRes.ok) return payload;
    const fallback = parseSearchResponse(await fallbackRes.json(), page);
    return { ...payload, results: mergeFallback(primaryItems, normalizeItems(fallback.results)) };
  } catch {
    return payload;
  }
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.trim() ?? "";
  const forceRefresh = searchParams.get("refresh") === "1";
  const pageParam = searchParams.get("page");
  const page = pageParam === null ? 1 : Number(pageParam);

  if (!query) {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }
  if (
    (pageParam !== null && !/^\d+$/.test(pageParam)) ||
    !Number.isSafeInteger(page) || page < 1 || page > MAX_SEARCH_PAGE
  ) {
    return NextResponse.json({ error: "Invalid page" }, { status: 400 });
  }

  if (!process.env.TMDB_API_KEY) {
    return NextResponse.json({ error: "Missing TMDB_API_KEY" }, { status: 500 });
  }

  const cacheKey = TMDB_CACHE_KEYS.search(query, page);
  if (!forceRefresh) {
    const cached = await readTmdbCache<SearchPayload>(cacheKey);
    if (cached) return tmdbJson(cached);
  }

  const userId = forceRefresh
    ? (await auth())?.user?.id ?? null
    : await getOptionalTmdbUserId();
  if (forceRefresh && !userId) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Not signed in" },
      { status: 401 },
    );
  }
  const rateLimited = enforceTmdbProxyRateLimit(request, userId, "search");

  try {
    const payload = await withTmdbInflightGuarded(
      cacheKey,
      () => rateLimited.beforeStart(),
      async () => {
        const result = await fetchSearch(query, page);
        await writeTmdbCache(cacheKey, result, TMDB_CACHE_TTL.search);
        return result;
      },
    );

    return rateLimited.apply(tmdbJson(payload));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "RATE_LIMITED" && rateLimited.response) {
      return rateLimited.response;
    }
    const status = message.startsWith("TMDB search failed:")
      ? Number(message.split(":")[1] || 502)
      : 502;
    return rateLimited.apply(
      NextResponse.json({ error: "TMDB search failed" }, {
        status,
        ...(status === 429 ? { headers: { "Retry-After": String(Math.max(1, tmdbRetryAfterSeconds())) } } : {}),
      }),
    );
  }
}
