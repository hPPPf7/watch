import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { tmdbCache } from "@/server/db/schema";

type CacheEntry<T> = {
  payload: T;
  expiresAt: Date;
};

const inFlight = new Map<string, Promise<unknown>>();

export const TMDB_CACHE_TTL = {
  recommendations: 24 * 60 * 60 * 1000,
  detail: 24 * 60 * 60 * 1000,
  search: 10 * 60 * 1000,
  season: 6 * 60 * 60 * 1000,
  collection: 7 * 24 * 60 * 60 * 1000,
} as const;

export const TMDB_CACHE_KEYS = {
  recommendations: {
    movie: "movie_recommendations",
    tv: "tv_recommendations",
    anime: "anime_recommendations",
  },
  detail: (type: "movie" | "tv", id: string) => `tmdb:detail:${type}:${id}`,
  search: (query: string) => `tmdb:search:${encodeURIComponent(query.toLowerCase())}`,
  season: (type: "tv", id: string, season: string) =>
    `tmdb:season:${type}:${id}:${season}`,
  collection: (id: string) => `tmdb:collection:${id}`,
} as const;

const getDbSafe = () => {
  try {
    return getDb();
  } catch {
    return null;
  }
};

export const readTmdbCache = async <T>(key: string): Promise<T | null> => {
  const db = getDbSafe();
  if (!db) return null;

  try {
    const rows = await db
      .select({
        payload: tmdbCache.payload,
        expiresAt: tmdbCache.expiresAt,
      })
      .from(tmdbCache)
      .where(eq(tmdbCache.key, key))
      .limit(1);
    const cached = rows[0] as CacheEntry<T> | undefined;
    if (!cached?.payload) return null;
    if (new Date(cached.expiresAt).getTime() <= Date.now()) return null;
    return cached.payload;
  } catch (error) {
    console.warn("tmdb cache read failed", { key, error });
    return null;
  }
};

export const writeTmdbCache = async (
  key: string,
  payload: unknown,
  ttlMs: number,
) => {
  const db = getDbSafe();
  if (!db) return;

  try {
    const now = new Date();
    await db
      .insert(tmdbCache)
      .values({
        key,
        payload,
        expiresAt: new Date(now.getTime() + ttlMs),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: tmdbCache.key,
        set: {
          payload,
          expiresAt: new Date(now.getTime() + ttlMs),
          updatedAt: now,
        },
      });
  } catch (error) {
    console.warn("tmdb cache write failed", { key, error });
  }
};

export const withTmdbInflight = async <T>(
  key: string,
  factory: () => Promise<T>,
): Promise<T> => {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const created = factory().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, created as Promise<unknown>);
  return created;
};

export const tmdbJson = (payload: unknown) =>
  NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
