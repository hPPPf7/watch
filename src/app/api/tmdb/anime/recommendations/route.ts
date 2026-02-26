import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { tmdbCache } from "@/server/db/schema";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const CACHE_KEY = "anime_recommendations";

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

const filterAnime = (items: TvListItem[]) =>
  items.filter((item) => item.genre_ids?.includes(16));

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

const fetchAnimeListUntilCount = async (category: string, targetCount = 20) => {
  const collected: TvListItem[] = [];
  const seen = new Set<number>();
  let page = 1;
  let totalPages = 1;
  const maxPages = 20;

  while (collected.length < targetCount && page <= totalPages && page <= maxPages) {
    const payload = await fetchTvList(category, page);
    if (!payload) break;
    const filtered = filterAnime(payload.results ?? []);
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

export async function GET() {
  if (!process.env.TMDB_API_KEY) {
    return NextResponse.json({ error: "Missing TMDB_API_KEY" }, { status: 500 });
  }

  let db;
  try {
    db = getDb();
  } catch {
    return NextResponse.json({ error: "Missing DATABASE_URL" }, { status: 500 });
  }

  const cachedRows = await db
    .select({
      payload: tmdbCache.payload,
      updatedAt: tmdbCache.updatedAt,
      expiresAt: tmdbCache.expiresAt,
    })
    .from(tmdbCache)
    .where(eq(tmdbCache.key, CACHE_KEY))
    .limit(1);

  const cached = cachedRows[0];
  if (cached?.payload && new Date(cached.expiresAt).getTime() > Date.now()) {
    const payload = cached.payload as { lists?: unknown[] };
    return NextResponse.json({
      updated_at: cached.updatedAt ?? new Date().toISOString(),
      lists: payload.lists ?? [],
    });
  }

  const [popular, onTheAir, topRated] = await Promise.all([
    fetchAnimeListUntilCount("popular"),
    fetchAnimeListUntilCount("on_the_air"),
    fetchAnimeListUntilCount("top_rated"),
  ]);

  const payload = {
    lists: [
      { key: "popular", title: "熱門", data: popular },
      { key: "on_the_air", title: "現正播出", data: onTheAir },
      { key: "top_rated", title: "高評分", data: topRated },
    ],
  };

  const now = new Date();
  await db
    .insert(tmdbCache)
    .values({
      key: CACHE_KEY,
      payload,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: tmdbCache.key,
      set: {
        payload,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        updatedAt: now,
      },
    });

  return NextResponse.json({
    updated_at: now.toISOString(),
    ...payload,
  });
}
