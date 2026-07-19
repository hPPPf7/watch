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
// getOrLoadDetailCache 內部用來仲裁「多個並行請求（skipCache 讓同一個
// key 可以同時有好幾個）裡誰有資格寫入快取」，key 的存續期間跟著 cache
// 走（過期 / LRU 逐出時一併清掉），不會脫離 cache 的大小限制無限增長。
const requestWriteSeq = new Map<string, number>();
const activeRequestCount = new Map<string, number>();
let writeSeqCounter = 0;
const MAX_CACHE_ENTRIES = 300;

const clearRequestWriteSeqIfUnused = (key: string) => {
  if (!cache.has(key) && !activeRequestCount.has(key)) {
    requestWriteSeq.delete(key);
  }
};

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
      clearRequestWriteSeqIfUnused(key);
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
    clearRequestWriteSeqIfUnused(key);
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
    clearRequestWriteSeqIfUnused(oldestKey);
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

    const existing = inFlight.get(key);
    if (existing) {
      if (options?.priority !== "background") existing.promote();
      return existing.promise as Promise<T | null>;
    }
  }

  const scheduled = requestSemaphore.schedule(
    loader,
    options?.priority ?? "foreground",
  );
  // skipCache 會讓同一個 key 同時存在多個並行請求（見上面 !skipCache 判斷）。
  // 「誰能寫入快取」用遞增序號仲裁（依「決定發起這次請求」的先後取號），
  // 只有序號比目前已知最新寫入還新的請求才能覆寫，避免較舊的請求把較新
  // 請求剛寫入的資料蓋掉；即使序號較新的那個請求最終失敗，也不會擋住
  // 序號較舊、仍在飛行中且最終成功的請求——跟「in-flight 目前是不是還
  // 是自己」脫鉤，才不會因為晚到但失敗的並行請求，讓整輪強制刷新即使
  // 有其他請求成功也完全沒反映到快取上。in-flight 登記的清除仍用物件
  // 身份比對，避免誤刪還在飛行中、屬於別人的登記。
  const writeSeq = ++writeSeqCounter;
  activeRequestCount.set(key, (activeRequestCount.get(key) ?? 0) + 1);
  const entry = {
    promise: scheduled.promise as Promise<unknown>,
    promote: scheduled.promote,
  };
  const request = scheduled.promise
    .then((data) => {
      if (data !== null) {
        const lastWriteSeq = requestWriteSeq.get(key) ?? 0;
        if (writeSeq > lastWriteSeq) {
          requestWriteSeq.set(key, writeSeq);
          setDetailCache(key, data, ttlMs);
        }
      }
      return data;
    })
    .finally(() => {
      if (inFlight.get(key) === entry) {
        inFlight.delete(key);
      }
      const remainingRequestCount = (activeRequestCount.get(key) ?? 1) - 1;
      if (remainingRequestCount > 0) {
        activeRequestCount.set(key, remainingRequestCount);
      } else {
        activeRequestCount.delete(key);
        clearRequestWriteSeqIfUnused(key);
      }
    });

  entry.promise = request as Promise<unknown>;
  inFlight.set(key, entry);
  return request;
};
