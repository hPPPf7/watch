import { NextResponse } from "next/server";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;

export const revalidate = ONE_WEEK_SECONDS;

const fetchMovieList = async (category: string) => {
  const url = new URL(`${TMDB_BASE_URL}/movie/${category}`);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY ?? "");
  url.searchParams.set("language", "zh-TW");
  url.searchParams.set("include_adult", "false");

  const response = await fetch(url.toString(), {
    next: { revalidate: ONE_WEEK_SECONDS },
  });

  if (!response.ok) return null;
  return response.json();
};

export async function GET() {
  if (!process.env.TMDB_API_KEY) {
    return NextResponse.json({ error: "Missing TMDB_API_KEY" }, { status: 500 });
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
      const response = await fetch(url.toString(), {
        next: { revalidate: ONE_WEEK_SECONDS },
      });
      if (!response.ok) return null;
      return response.json();
    })(),
  ]);

  return NextResponse.json({
    updated_at: new Date().toISOString(),
    lists: [
      { key: "popular", title: "熱門", data: popular?.results ?? [] },
      { key: "now_playing", title: "上映中", data: nowPlaying?.results ?? [] },
      { key: "top_rated", title: "高分", data: topRated?.results ?? [] },
      { key: "anime", title: "動畫", data: anime?.results ?? [] },
    ],
  });
}
