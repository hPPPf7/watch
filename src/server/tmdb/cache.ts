import { NextResponse } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { tmdbCache } from "@/server/db/schema";
import { readThroughRedis, writeRedisJson } from "@/server/realtime/redis";

type CacheEntry<T> = {
  payload: T;
  expiresAt: Date;
  updatedAt: Date | null;
};

export type TmdbCacheEntry<T> = CacheEntry<T> & {
  expired: boolean;
};

const inFlight = new Map<string, Promise<unknown>>();
const inFlightStartup = new Map<string, Promise<void>>();
let lastCleanupAt = 0;

const CACHE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const CACHE_EXPIRED_GRACE_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ROWS = 50000;

export const TMDB_CACHE_TTL = {
  recommendations: 24 * 60 * 60 * 1000,
  detail: 24 * 60 * 60 * 1000,
  search: 30 * 60 * 1000,
  season: 24 * 60 * 60 * 1000,
  collection: 7 * 24 * 60 * 60 * 1000,
} as const;

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const RECOMMENDATIONS_REFRESH_HOUR_TAIPEI = 5;

export const getRecommendationsTtlMs = (now = new Date()) => {
  const taipeiNowMs = now.getTime() + TAIPEI_OFFSET_MS;
  const taipeiNow = new Date(taipeiNowMs);
  const refreshTodayTaipeiMs = Date.UTC(
    taipeiNow.getUTCFullYear(),
    taipeiNow.getUTCMonth(),
    taipeiNow.getUTCDate(),
    RECOMMENDATIONS_REFRESH_HOUR_TAIPEI,
    0,
    0,
    0,
  );
  const nextRefreshTaipeiMs =
    taipeiNowMs < refreshTodayTaipeiMs
      ? refreshTodayTaipeiMs
      : refreshTodayTaipeiMs + 24 * 60 * 60 * 1000;
  return Math.max(60 * 1000, nextRefreshTaipeiMs - taipeiNowMs);
};

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

// 這個模組原本的 key（如 "movie_recommendations"）沒有固定前綴，
// 在 Redis 這個所有子系統共用的單一命名空間裡直接沿用會有跟其他
// 用途 key 意外撞名的風險；統一包一層前綴隔開。
const tmdbRedisKey = (key: string) => `tmdb-cache:${key}`;

export const readTmdbCache = async <T>(key: string): Promise<T | null> => {
  // Redis 優先：detail / season / search / recommendations / collection
  // 這些單筆讀取是清單、搜尋、首頁推薦的熱路徑，Redis 命中直接跳過 Neon。
  // miss 或 Redis 失敗一律 fallback 回 Neon（Neon 才是 source of truth，
  // Redis 只是加速用的鏡像，讀取失敗不影響資料正確性）。
  return readThroughRedis<T>(tmdbRedisKey(key), async () => {
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
      const expiresAtMs = new Date(cached.expiresAt).getTime();
      if (expiresAtMs <= Date.now()) return null;
      // 下面這行離上面的新鮮度檢查只隔一個同步敘述，理論上不會變號；
      // 用 Math.max 墊底只是避免萬一卡在毫秒邊界時，回填被
      // writeRedisJson 的 ttl<=0 判斷悄悄跳過、卻沒有任何警告。
      return {
        payload: cached.payload,
        remainingTtlMs: Math.max(1000, expiresAtMs - Date.now()),
      };
    } catch (error) {
      console.warn("tmdb cache read failed", { key, error });
      return null;
    }
  });
};

// 這兩支批次讀取（readManyTmdbCache / readManyTmdbCacheIncludingExpired）
// 刻意不套用 Redis 優先：後者需要「回傳已過期但仍可用」的資料做
// stale-while-revalidate（Neon 靠 grace period 不馬上刪除過期列才辦得到，
// Redis 原生 TTL 到期會直接整筆消失，無法比照複製這個語意）。呼叫端
// （calendarMetadata / watchlistCardMetadata）流量遠低於 detail/season
// 這類熱路徑，先維持 Neon-only，之後真的有壓力再評估另外設計。
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

export const readManyTmdbCacheIncludingExpired = async <T>(
  keys: string[],
): Promise<Map<string, TmdbCacheEntry<T>>> => {
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
    const entries = new Map<string, TmdbCacheEntry<T>>();

    rows.forEach((row) => {
      if (!row.payload) return;
      const expired = new Date(row.expiresAt).getTime() <= now;
      entries.set(row.key, {
        payload: row.payload as T,
        expiresAt: row.expiresAt,
        updatedAt: row.updatedAt,
        expired,
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
  options?: { skipRedisMirror?: boolean },
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

    if (!options?.skipRedisMirror) {
      // 鏡像寫入 Redis，讓後續讀取直接命中不用再回 Neon。這裡就是最新
      // 資料本身，不需要 NX（跟 readTmdbCache 的回填不同，那裡是可能落後
      // 的舊資料，才需要避免蓋掉更新的值）。不 await：這個路徑通常接在
      // TMDB fetch 之後，鏡像寫入不應該再拖慢已經在等的呼叫端回應。
      // skipRedisMirror 給那些其實不是「TMDB 快取」、只是借用這張表
      // 存 key-value 的呼叫端用（例如 cron 執行摘要），避免這個模組的
      // tmdb-cache: 命名空間混進非 TMDB 資料，也省下完全沒人會透過
      // Redis 讀取的白工寫入。
      void writeRedisJson(tmdbRedisKey(key), payload, ttlMs);
    }

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

export const withTmdbInflightGuarded = <T>(
  key: string,
  beforeStart: () => Promise<void> | void,
  factory: () => Promise<T>,
): Promise<T> => {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  // 這裡刻意在重用既有 inflight 時不再重跑 beforeStart()。
  // TMDB 代理限流要保護的是「實際打到 TMDB upstream 的 miss 次數」，
  // 不是同一個 cache key 的前端重送/多分頁併發請求數；
  // 否則同一個 upstream fetch 會被重複扣額度，和目前產品想保護的對象不一致。
  if (existing) return existing;

  const starting = inFlightStartup.get(key);
  if (starting) {
    return starting
      .catch(() => undefined)
      .then(() => withTmdbInflightGuarded(key, beforeStart, factory));
  }

  let startupResolve!: () => void;
  let startupReject!: (reason?: unknown) => void;
  const startup = new Promise<void>((resolve, reject) => {
    startupResolve = resolve;
    startupReject = reject;
  });
  inFlightStartup.set(key, startup);

  const guarded = (async () => {
    try {
      await beforeStart();
      const created = Promise.resolve(factory()).finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, created as Promise<unknown>);
      startupResolve();
      return await created;
    } catch (error) {
      startupReject(error);
      throw error;
    } finally {
      inFlightStartup.delete(key);
    }
  })();

  return guarded;
};

export const tmdbJson = (payload: unknown) =>
  NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
