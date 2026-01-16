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

  const nowPlaying = await fetchMovieList("now_playing");

  return NextResponse.json({
    updated_at: new Date().toISOString(),
    lists: [
      { key: "now_playing", title: "上映中", data: nowPlaying?.results ?? [] },
    ],
  });
}
