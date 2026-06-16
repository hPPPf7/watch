import { NextResponse } from "next/server";
import {
  readTmdbCache,
  getRecommendationsTtlMs,
  TMDB_CACHE_KEYS,
  tmdbJson,
  withTmdbInflightGuarded,
  writeTmdbCache,
} from "@/server/tmdb/cache";
import { getOptionalTmdbUserId } from "@/server/tmdb/auth";
import { enforceTmdbProxyRateLimit } from "@/server/tmdb/rateLimit";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const CACHE_KEY = TMDB_CACHE_KEYS.recommendations.tv;

export const dynamic = "force-dynamic";

type TvListItem = {
  id: number;
  genre_ids?: number[];
};

type TvListResponse = {
  results?: TvListItem[];
  page?: number;
  total_pages?: number;
};

const filterNonAnime = (items: TvListItem[]) =>
  items.filter((item) => !item.genre_ids?.includes(16));

const fetchTvList = async (category: string, page = 1) => {
  const url = new URL(`${TMDB_BASE_URL}/tv/${category}`);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY ?? "");
  url.searchParams.set("language", "zh-TW");
  url.searchParams.set("include_adult", "false");
  url.searchParams.set("page", String(page));

  const response = await fetch(url.toString());
  if (!response.ok) return null;
  return (await response.json()) as TvListResponse;
};

const fetchTvListUntilCount = async (category: string, targetCount = 20) => {
  const collected: TvListItem[] = [];
  const seen = new Set<number>();
  let page = 1;
  let totalPages = 1;
  const maxPages = 20;

  while (collected.length < targetCount && page <= totalPages && page <= maxPages) {
    const payload = await fetchTvList(category, page);
    if (!payload) break;
    const filtered = filterNonAnime(payload.results ?? []);
    filtered.forEach((item) => {
      if (seen.has(item.id)) return;
      seen.add(item.id);
      collected.push(item);
    });
    totalPages = payload.total_pages ?? totalPages;
    page += 1;
  }

  return collected.slice(0, targetCount);
};

export async function GET(request: Request) {
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

  const rateLimited = enforceTmdbProxyRateLimit(
    request,
    await getOptionalTmdbUserId(),
    "recommendations_tv",
  );

  const payload = await withTmdbInflightGuarded(
    CACHE_KEY,
    () => rateLimited.beforeStart(),
    async () => {
      const [popular, onTheAir, topRated] = await Promise.all([
        fetchTvListUntilCount("popular"),
        fetchTvListUntilCount("on_the_air"),
        fetchTvListUntilCount("top_rated"),
      ]);
      return {
        lists: [
          { key: "popular", title: "熱門", data: popular },
          { key: "on_the_air", title: "現正播出", data: onTheAir },
          { key: "top_rated", title: "高評分", data: topRated },
        ],
      };
    },
  ).catch((error: unknown) => {
    if (
      error instanceof Error &&
      error.message === "RATE_LIMITED" &&
      rateLimited.response
    ) {
      return null;
    }
    throw error;
  });
  if (!payload) return rateLimited.response!;

  const responsePayload = {
    updated_at: new Date().toISOString(),
    ...payload,
  };
  await writeTmdbCache(CACHE_KEY, responsePayload, getRecommendationsTtlMs());
  return rateLimited.apply(tmdbJson(responsePayload));
}
