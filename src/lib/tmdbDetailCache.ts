import {
  createSemaphore,
  type SemaphorePriority,
} from "@/lib/asyncPool";

type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<
  string,
  { promise: Promise<unknown>; promote: () => void }
>();
const MAX_CACHE_ENTRIES = 300;

// 同時最多幾個「真的在飛行中」的網路請求（快取命中、in-flight 搭便車
// 都不算，只有真正呼叫 loader() 才會排隊）。這是共用的單一限制點，
// WatchlistSection 的清單狀態檢查、即將播出分頁、DetailModal 的集數
// 載入都會經過這裡，不用再各自猜「外層併發 x 內層併發」的乘積。
const REQUEST_CONCURRENCY_LIMIT = 4;
const requestSemaphore = createSemaphore(REQUEST_CONCURRENCY_LIMIT);

const pruneExpired = () => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
};

export const DEFAULT_DETAIL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SHORT_DETAIL_TTL_MS = 6 * 60 * 60 * 1000;

// 集數清單的 in-memory 快取壽命依作品狀態決定：
// 已完結 / 已取消的作品集數幾乎不變，可以吃長快取；
// 播出中（或狀態未知）的作品集數會持續新增、改名，長快取在桌面版
// 常駐 session 下會讓新集數偵測卡在舊資料，必須用短 TTL。
export const resolveSeasonEpisodesClientTtlMs = (
  status?: string | null,
): number => {
  const normalized = status?.toLowerCase() ?? "";
  return normalized === "ended" || normalized === "canceled"
    ? DEFAULT_DETAIL_TTL_MS
    : SHORT_DETAIL_TTL_MS;
};

export const getDetailCache = <T>(key: string): T | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.data as T;
};

export const setDetailCache = <T>(
  key: string,
  data: T,
  ttlMs: number = DEFAULT_DETAIL_TTL_MS
) => {
  pruneExpired();
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
};

export const getOrLoadDetailCache = async <T>(
  key: string,
  loader: () => Promise<T | null>,
  ttlMs: number = DEFAULT_DETAIL_TTL_MS,
  options?: { skipCache?: boolean; priority?: SemaphorePriority },
): Promise<T | null> => {
  if (!options?.skipCache) {
    const cached = getDetailCache<T>(key);
    if (cached) return cached;
  }

  const existing = inFlight.get(key);
  if (existing) {
    if (options?.priority !== "background") existing.promote();
    return existing.promise as Promise<T | null>;
  }

  const scheduled = requestSemaphore.schedule(
    loader,
    options?.priority ?? "foreground",
  );
  const request = scheduled.promise
    .then((data) => {
      if (data !== null) {
        setDetailCache(key, data, ttlMs);
      }
      return data;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, {
    promise: request as Promise<unknown>,
    promote: scheduled.promote,
  });
  return request;
};
