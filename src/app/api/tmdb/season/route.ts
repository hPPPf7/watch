import { NextResponse } from "next/server";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

type TMDBEpisode = {
  episode_number?: number;
  name?: string;
};

type TMDBSeason = {
  episodes?: TMDBEpisode[];
};

const buildSeasonUrl = (id: string, season: string, language: string) => {
  const url = new URL(`${TMDB_BASE_URL}/tv/${id}/season/${season}`);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY ?? "");
  url.searchParams.set("language", language);
  return url.toString();
};

const normalizeEpisodes = (
  primary: TMDBSeason,
  fallback?: TMDBSeason
) => {
  const primaryEpisodes = primary.episodes ?? [];
  const fallbackEpisodes = fallback?.episodes ?? [];
  const fallbackMap = new Map(
    fallbackEpisodes.map((episode) => [
      episode.episode_number ?? 0,
      episode,
    ])
  );

  return primaryEpisodes
    .filter((episode) => (episode.episode_number ?? 0) > 0)
    .map((episode) => {
      const number = episode.episode_number ?? 0;
      const fallbackEpisode = fallbackMap.get(number);
      const name =
        episode.name?.trim() ||
        fallbackEpisode?.name?.trim() ||
        null;
      return {
        episode_number: number,
        name,
      };
    });
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const season = searchParams.get("season");
  const type = searchParams.get("type");

  if (!id || !season || type !== "tv") {
    return NextResponse.json(
      { error: "Missing or invalid parameters" },
      { status: 400 }
    );
  }

  if (!process.env.TMDB_API_KEY) {
    return NextResponse.json({ error: "Missing TMDB_API_KEY" }, { status: 500 });
  }

  const [primaryRes, fallbackRes] = await Promise.all([
    fetch(buildSeasonUrl(id, season, "zh-TW"), { cache: "no-store" }),
    fetch(buildSeasonUrl(id, season, "en-US"), { cache: "no-store" }),
  ]);

  if (!primaryRes.ok) {
    return NextResponse.json(
      { error: "TMDB season failed" },
      { status: primaryRes.status }
    );
  }

  const primary = (await primaryRes.json()) as TMDBSeason;
  const fallback = fallbackRes.ok
    ? ((await fallbackRes.json()) as TMDBSeason)
    : undefined;

  const episodes = normalizeEpisodes(primary, fallback);
  return NextResponse.json({ episodes });
}
