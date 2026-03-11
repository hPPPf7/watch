import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  readTmdbCache,
  TMDB_CACHE_KEYS,
  TMDB_CACHE_TTL,
  tmdbJson,
  withTmdbInflight,
  writeTmdbCache,
} from "@/server/tmdb/cache";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

type TMDBEpisode = {
  episode_number?: number;
  name?: string;
  air_date?: string | null;
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

const normalizeEpisodes = (primary: TMDBSeason, fallback?: TMDBSeason) => {
  const primaryEpisodes = primary.episodes ?? [];
  const fallbackEpisodes = fallback?.episodes ?? [];
  const fallbackMap = new Map(
    fallbackEpisodes.map((episode) => [episode.episode_number ?? 0, episode]),
  );

  return primaryEpisodes
    .filter((episode) => (episode.episode_number ?? 0) > 0)
    .map((episode) => {
      const number = episode.episode_number ?? 0;
      const fallbackEpisode = fallbackMap.get(number);
      const name = episode.name?.trim() || fallbackEpisode?.name?.trim() || null;
      const airDate = episode.air_date || fallbackEpisode?.air_date || null;
      return {
        episode_number: number,
        name,
        air_date: airDate,
      };
    });
};

const isPositiveIntegerString = (value: string | null): value is string =>
  value !== null && /^[1-9]\d*$/.test(value);

const needsSeasonFallback = (
  episodes: Array<{ episode_number: number; name: string | null; air_date: string | null }>,
) => episodes.some((episode) => !episode.name || !episode.air_date);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const season = searchParams.get("season");
  const type = searchParams.get("type");
  const forceRefresh = searchParams.get("refresh") === "1";

  // 目前前端刻意不顯示 TMDB specials（season 0），這支 route 也只接受第 1 季以上。
  if (!isPositiveIntegerString(id) || !isPositiveIntegerString(season) || type !== "tv") {
    return NextResponse.json(
      { error: "Missing or invalid parameters" },
      { status: 400 },
    );
  }

  const validatedId = id;
  const validatedSeason = season;

  if (forceRefresh) {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { code: "UNAUTHORIZED", message: "Not signed in" },
        { status: 401 },
      );
    }
  }

  if (!process.env.TMDB_API_KEY) {
    return NextResponse.json({ error: "Missing TMDB_API_KEY" }, { status: 500 });
  }

  const cacheKey = TMDB_CACHE_KEYS.season("tv", validatedId, validatedSeason);
  if (!forceRefresh) {
    const cached = await readTmdbCache<{
      episodes: Array<{ episode_number: number; name: string | null; air_date: string | null }>;
    }>(cacheKey);
    if (cached) return tmdbJson(cached);
  }

  try {
    const payload = await withTmdbInflight(cacheKey, async () => {
      const primaryRes = await fetch(buildSeasonUrl(validatedId, validatedSeason, "zh-TW"), {
        cache: "no-store",
      });

      if (!primaryRes.ok) {
        throw new Error(`TMDB season failed:${primaryRes.status}`);
      }

      const primary = (await primaryRes.json()) as TMDBSeason;
      const primaryEpisodes = normalizeEpisodes(primary);
      if (!needsSeasonFallback(primaryEpisodes)) {
        return { episodes: primaryEpisodes };
      }

      const fallbackRes = await fetch(buildSeasonUrl(validatedId, validatedSeason, "en-US"), {
        cache: "no-store",
      }).catch(() => null);
      const fallback = fallbackRes?.ok
        ? ((await fallbackRes.json()) as TMDBSeason)
        : undefined;

      return { episodes: normalizeEpisodes(primary, fallback) };
    });

    await writeTmdbCache(cacheKey, payload, TMDB_CACHE_TTL.season);
    return tmdbJson(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith("TMDB season failed:")
      ? Number(message.split(":")[1] || 502)
      : 502;
    return NextResponse.json({ error: "TMDB season failed" }, { status });
  }
}
