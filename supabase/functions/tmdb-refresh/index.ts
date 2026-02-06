import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const PROJECT_ID = "watch";

const SUPABASE_URL = Deno.env.get("SUPA_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPA_SERVICE_ROLE_KEY") ?? "";
const TMDB_API_KEY = Deno.env.get("TMDB_API_KEY") ?? "";

const MAX_PAGES = Number(Deno.env.get("TMDB_CHANGES_MAX_PAGES") ?? "5");
const CONCURRENCY = Number(Deno.env.get("TMDB_REFRESH_CONCURRENCY") ?? "5");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !TMDB_API_KEY) {
  console.warn("Missing SUPA_URL / SUPA_SERVICE_ROLE_KEY / TMDB_API_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

type ChangeListResponse = {
  page: number;
  total_pages: number;
  results: Array<{ id: number }>;
};

type TMDBGenre = { id: number };

type TMDBMovieDetail = {
  id: number;
  title?: string;
  release_date?: string;
  poster_path?: string | null;
  genres?: TMDBGenre[];
};

type TMDBTvDetail = {
  id: number;
  name?: string;
  first_air_date?: string;
  poster_path?: string | null;
  genres?: TMDBGenre[];
  status?: string;
  seasons?: Array<{ season_number?: number; episode_count?: number | null }>;
};

const buildChangesUrl = (
  type: "movie" | "tv",
  startDate: string,
  endDate: string,
  page: number,
) => {
  const url = new URL(`${TMDB_BASE_URL}/${type}/changes`);
  url.searchParams.set("api_key", TMDB_API_KEY);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set("page", String(page));
  return url.toString();
};

const buildDetailUrl = (type: "movie" | "tv", id: number) => {
  const url = new URL(`${TMDB_BASE_URL}/${type}/${id}`);
  url.searchParams.set("api_key", TMDB_API_KEY);
  url.searchParams.set("language", "zh-TW");
  return url.toString();
};

const getDateString = (value: Date) => value.toISOString().slice(0, 10);

const chunk = <T>(arr: T[], size: number) => {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
};

const mapWithConcurrency = async <T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
) => {
  let index = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await fn(current);
    }
  });
  await Promise.all(workers);
};

const fetchChanges = async (type: "movie" | "tv", start: string, end: string) => {
  const ids = new Set<number>();
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= MAX_PAGES) {
    const res = await fetch(buildChangesUrl(type, start, end, page));
    if (!res.ok) {
      throw new Error(`TMDB changes failed: ${type} ${res.status}`);
    }
    const data = (await res.json()) as ChangeListResponse;
    data.results.forEach((entry) => ids.add(entry.id));
    totalPages = data.total_pages;
    page += 1;
  }

  return Array.from(ids);
};

const loadWatchlistIds = async (type: "movie" | "tv", ids: number[]) => {
  if (ids.length === 0) return [] as number[];
  const chunks = chunk(ids, 200);
  const matched = new Set<number>();

  for (const batch of chunks) {
    const { data, error } = await supabase
      .from("watchlist_items")
      .select("tmdb_id")
      .eq("project_id", PROJECT_ID)
      .eq("media_type", type)
      .in("tmdb_id", batch);
    if (error) {
      console.warn("watchlist_items lookup failed", error.message);
      continue;
    }
    (data ?? []).forEach((row: { tmdb_id: number }) => matched.add(row.tmdb_id));
  }

  return Array.from(matched);
};

const fetchDetail = async (type: "movie" | "tv", id: number) => {
  const res = await fetch(buildDetailUrl(type, id));
  if (!res.ok) return null;
  return (await res.json()) as TMDBMovieDetail | TMDBTvDetail;
};

const updateMovie = async (detail: TMDBMovieDetail) => {
  const year = detail.release_date ? detail.release_date.slice(0, 4) : null;
  const isAnime = (detail.genres ?? []).some((genre) => genre.id === 16);
  const updates = {
    title: detail.title ?? "",
    year,
    release_date: detail.release_date ?? null,
    poster_path: detail.poster_path ?? null,
    is_anime: isAnime,
    tmdb_cached_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("watchlist_items")
    .update(updates)
    .eq("project_id", PROJECT_ID)
    .eq("media_type", "movie")
    .eq("tmdb_id", detail.id);

  if (error) {
    console.warn("movie update failed", detail.id, error.message);
  }
};

const updateTv = async (detail: TMDBTvDetail) => {
  const year = detail.first_air_date ? detail.first_air_date.slice(0, 4) : null;
  const isAnime = (detail.genres ?? []).some((genre) => genre.id === 16);
  const totalAired = Array.isArray(detail.seasons)
    ? detail.seasons.reduce((sum, season) => {
        if ((season.season_number ?? 0) <= 0) return sum;
        return sum + (season.episode_count ?? 0);
      }, 0)
    : 0;
  const updates = {
    title: detail.name ?? "",
    year,
    release_date: null,
    poster_path: detail.poster_path ?? null,
    is_anime: isAnime,
    tmdb_cached_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("watchlist_items")
    .update(updates)
    .eq("project_id", PROJECT_ID)
    .eq("media_type", "tv")
    .eq("tmdb_id", detail.id);

  if (error) {
    console.warn("tv update failed", detail.id, error.message);
  }

  const { error: stateError } = await supabase
    .from("watchlist_tv_states")
    .update({
      ...(detail.status ? { last_known_status: detail.status } : {}),
      ...(totalAired > 0 ? { last_total_aired: totalAired } : {}),
      last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("project_id", PROJECT_ID)
    .eq("tmdb_id", detail.id);

  if (stateError) {
    console.warn("tv state update failed", detail.id, stateError.message);
  }
};

serve(async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !TMDB_API_KEY) {
    return new Response("Missing environment configuration", { status: 500 });
  }

  const now = new Date();
  const endDate = getDateString(now);
  const startDate = getDateString(new Date(now.getTime() - 48 * 60 * 60 * 1000));

  try {
    const [movieChanges, tvChanges] = await Promise.all([
      fetchChanges("movie", startDate, endDate),
      fetchChanges("tv", startDate, endDate),
    ]);

    const [movieTargets, tvTargets] = await Promise.all([
      loadWatchlistIds("movie", movieChanges),
      loadWatchlistIds("tv", tvChanges),
    ]);

    await mapWithConcurrency(movieTargets, CONCURRENCY, async (id) => {
      const detail = await fetchDetail("movie", id);
      if (detail) {
        await updateMovie(detail as TMDBMovieDetail);
      }
    });

    await mapWithConcurrency(tvTargets, CONCURRENCY, async (id) => {
      const detail = await fetchDetail("tv", id);
      if (detail) {
        await updateTv(detail as TMDBTvDetail);
      }
    });

    return new Response(
      JSON.stringify({
        ok: true,
        movieTargets: movieTargets.length,
        tvTargets: tvTargets.length,
        window: { startDate, endDate },
        maxPages: MAX_PAGES,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("tmdb refresh failed", error);
    return new Response("tmdb refresh failed", { status: 500 });
  }
});
