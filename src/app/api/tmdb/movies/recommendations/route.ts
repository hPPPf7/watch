import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const CACHE_KEY = "movie_recommendations";

export const dynamic = "force-dynamic";

const fetchMovieList = async (category: string) => {
  const url = new URL(`${TMDB_BASE_URL}/movie/${category}`);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY ?? "");
  url.searchParams.set("language", "zh-TW");
  url.searchParams.set("include_adult", "false");

  const response = await fetch(url.toString());

  if (!response.ok) return null;
  return response.json();
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

  const [nowPlaying, popular, topRated, anime] = await Promise.all([
    fetchMovieList("now_playing"),
    fetchMovieList("popular"),
    fetchMovieList("top_rated"),
    (async () => {
      const url = new URL(`${TMDB_BASE_URL}/discover/movie`);
      url.searchParams.set("api_key", process.env.TMDB_API_KEY ?? "");
      url.searchParams.set("language", "zh-TW");
      url.searchParams.set("include_adult", "false");
      url.searchParams.set("with_genres", "16");
      const response = await fetch(url.toString());
      if (!response.ok) return null;
      return response.json();
    })(),
  ]);

  const payload = {
    lists: [
      { key: "popular", title: "熱門", data: popular?.results ?? [] },
      { key: "now_playing", title: "上映中", data: nowPlaying?.results ?? [] },
      { key: "top_rated", title: "高分", data: topRated?.results ?? [] },
      { key: "anime", title: "動畫", data: anime?.results ?? [] },
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
