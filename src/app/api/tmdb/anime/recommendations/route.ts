import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

const fetchAnimeListUntilCount = async (
  category: string,
  targetCount = 20
) => {
  const collected: TvListItem[] = [];
  let page = 1;
  let totalPages = 1;
  const maxPages = 20;

  while (
    collected.length < targetCount &&
    page <= totalPages &&
    page <= maxPages
  ) {
    const payload = await fetchTvList(category, page);
    if (!payload) break;
    const filtered = filterAnime(payload.results ?? []);
    collected.push(...filtered);
    totalPages = payload.total_pages ?? totalPages;
    page += 1;
  }

  return collected.slice(0, targetCount);
};

export async function GET() {
  if (!process.env.TMDB_API_KEY) {
    return NextResponse.json({ error: "Missing TMDB_API_KEY" }, { status: 500 });
  }
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return NextResponse.json(
      { error: "Missing Supabase credentials" },
      { status: 500 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const cacheDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
  }).format(new Date());

  const { data: cached, error: cacheError } = await supabase
    .from("tmdb_cache")
    .select("data, updated_at")
    .eq("cache_key", CACHE_KEY)
    .eq("cache_date", cacheDate)
    .maybeSingle();

  if (!cacheError && cached?.data) {
    return NextResponse.json({
      updated_at: cached.updated_at,
      lists: cached.data.lists ?? [],
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
      { key: "on_the_air", title: "播出中", data: onTheAir },
      { key: "top_rated", title: "高分", data: topRated },
    ],
  };

  const { error: upsertError } = await supabase.from("tmdb_cache").upsert({
    cache_key: CACHE_KEY,
    cache_date: cacheDate,
    data: payload,
  });

  if (upsertError) {
    return NextResponse.json({
      updated_at: new Date().toISOString(),
      ...payload,
    });
  }

  await supabase
    .from("tmdb_cache")
    .delete()
    .eq("cache_key", CACHE_KEY)
    .neq("cache_date", cacheDate);

  const { data: stored } = await supabase
    .from("tmdb_cache")
    .select("updated_at")
    .eq("cache_key", CACHE_KEY)
    .eq("cache_date", cacheDate)
    .maybeSingle();

  return NextResponse.json({
    updated_at: stored?.updated_at ?? new Date().toISOString(),
    ...payload,
  });
}
