type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry<unknown>>();
const MAX_CACHE_ENTRIES = 300;

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
