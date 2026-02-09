import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const PROJECT_ID = "watch";

const SUPABASE_URL = Deno.env.get("SUPA_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPA_SERVICE_ROLE_KEY") ?? "";
const TMDB_API_KEY = Deno.env.get("TMDB_API_KEY") ?? "";

const STALE_DAYS = Number(Deno.env.get("TMDB_STALE_DAYS") ?? "150");
const BATCH_SIZE = Number(Deno.env.get("TMDB_STALE_BATCH") ?? "40");
const CONCURRENCY = Number(Deno.env.get("TMDB_REFRESH_CONCURRENCY") ?? "5");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !TMDB_API_KEY) {
  console.warn("Missing SUPA_URL / SUPA_SERVICE_ROLE_KEY / TMDB_API_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

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

type StaleRow = {
  user_id: string;
  project_id: string;
  media_type: "movie" | "tv";
  tmdb_id: number;
};

const buildDetailUrl = (type: "movie" | "tv", id: number) => {
  const url = new URL(`${TMDB_BASE_URL}/${type}/${id}`);
  url.searchParams.set("api_key", TMDB_API_KEY);
  url.searchParams.set("language", "zh-TW");
  return url.toString();
};

const getDateString = (value: Date) => value.toISOString().slice(0, 10);

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

const fetchDetail = async (type: "movie" | "tv", id: number) => {
  const res = await fetch(buildDetailUrl(type, id));
  if (!res.ok) return null;
  return (await res.json()) as TMDBMovieDetail | TMDBTvDetail;
};

const updateMovie = async (row: StaleRow, detail: TMDBMovieDetail) => {
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
    .eq("user_id", row.user_id)
    .eq("project_id", row.project_id)
    .eq("media_type", "movie")
    .eq("tmdb_id", detail.id);

  if (error) {
    console.warn("stale movie update failed", detail.id, error.message);
  }
};

const updateTv = async (row: StaleRow, detail: TMDBTvDetail) => {
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
    .eq("user_id", row.user_id)
    .eq("project_id", row.project_id)
    .eq("media_type", "tv")
    .eq("tmdb_id", detail.id);

  if (error) {
    console.warn("stale tv update failed", detail.id, error.message);
  }

  const { error: stateError } = await supabase
    .from("watchlist_tv_states")
    .update({
      ...(detail.status ? { last_known_status: detail.status } : {}),
      ...(totalAired > 0 ? { last_total_aired: totalAired } : {}),
      last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", row.user_id)
    .eq("project_id", row.project_id)
    .eq("tmdb_id", detail.id);

  if (stateError) {
    console.warn("stale tv state update failed", detail.id, stateError.message);
  }
};

serve(async (req) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !TMDB_API_KEY) {
    return new Response("Missing environment configuration", { status: 500 });
  }

  const providedKey = req.headers.get("x-service-key") ?? "";
  if (!providedKey || providedKey !== SUPABASE_SERVICE_ROLE_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }

  const staleBefore = getDateString(
    new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000),
  );

  try {
    const { data, error } = await supabase
      .from("watchlist_items")
      .select("user_id, project_id, media_type, tmdb_id")
      .eq("project_id", PROJECT_ID)
      .lte("tmdb_cached_at", staleBefore)
      .order("tmdb_cached_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) {
      return new Response(`stale fetch failed: ${error.message}`, {
        status: 500,
      });
    }

    const rows = (data ?? []) as StaleRow[];
    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, refreshed: 0, staleBefore }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    await mapWithConcurrency(rows, CONCURRENCY, async (row) => {
      const detail = await fetchDetail(row.media_type, row.tmdb_id);
      if (!detail) return;
      if (row.media_type === "movie") {
        await updateMovie(row, detail as TMDBMovieDetail);
      } else {
        await updateTv(row, detail as TMDBTvDetail);
      }
    });

    return new Response(
      JSON.stringify({
        ok: true,
        refreshed: rows.length,
        staleBefore,
        batchSize: BATCH_SIZE,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("stale refresh failed", error);
    return new Response("stale refresh failed", { status: 500 });
  }
});
