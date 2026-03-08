import { NextResponse } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { tmdbCache } from "@/server/db/schema";

type CacheEntry<T> = {
  payload: T;
  expiresAt: Date;
  updatedAt: Date | null;
};

const inFlight = new Map<string, Promise<unknown>>();
let lastCleanupAt = 0;

const CACHE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const CACHE_EXPIRED_GRACE_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ROWS = 50000;

export const TMDB_CACHE_TTL = {
  recommendations: 24 * 60 * 60 * 1000,
  detail: 72 * 60 * 60 * 1000,
  search: 10 * 60 * 1000,
  season: 24 * 60 * 60 * 1000,
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
        updatedAt: tmdbCache.updatedAt,
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

export const readManyTmdbCache = async <T>(
  keys: string[],
): Promise<Map<string, CacheEntry<T>>> => {
  const db = getDbSafe();
  if (!db || keys.length === 0) return new Map();

  try {
    const uniqueKeys = Array.from(new Set(keys));
    const rows = await db
      .select({
        key: tmdbCache.key,
        payload: tmdbCache.payload,
        expiresAt: tmdbCache.expiresAt,
        updatedAt: tmdbCache.updatedAt,
      })
      .from(tmdbCache)
      .where(inArray(tmdbCache.key, uniqueKeys));

    const now = Date.now();
    const entries = new Map<string, CacheEntry<T>>();

    rows.forEach((row) => {
      if (!row.payload) return;
      if (new Date(row.expiresAt).getTime() <= now) return;
      entries.set(row.key, {
        payload: row.payload as T,
        expiresAt: row.expiresAt,
        updatedAt: row.updatedAt,
      });
    });

    return entries;
  } catch (error) {
    console.warn("tmdb cache batch read failed", { keyCount: keys.length, error });
    return new Map();
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

    // 控制快取表大小；每個行程最多每小時清理一次。
    void runCacheMaintenance(db);
  } catch (error) {
    console.warn("tmdb cache write failed", { key, error });
  }
};

const runCacheMaintenance = async (db: ReturnType<typeof getDb>) => {
  const now = Date.now();
  if (now - lastCleanupAt < CACHE_CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;

  try {
    const expiredBefore = new Date(now - CACHE_EXPIRED_GRACE_MS);
    await db
      .delete(tmdbCache)
      .where(sql`${tmdbCache.expiresAt} < ${expiredBefore}`);

    await db.execute(sql`
      WITH overflow AS (
        SELECT ${tmdbCache.key} AS key
        FROM ${tmdbCache}
        ORDER BY ${tmdbCache.updatedAt} DESC
        OFFSET ${CACHE_MAX_ROWS}
      )
      DELETE FROM ${tmdbCache}
      WHERE ${tmdbCache.key} IN (SELECT key FROM overflow)
    `);
  } catch (error) {
    console.warn("tmdb cache maintenance failed", { error });
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
