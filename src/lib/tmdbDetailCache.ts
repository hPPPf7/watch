type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry<unknown>>();

export const DEFAULT_DETAIL_TTL_MS = 24 * 60 * 60 * 1000;

export const getDetailCache = <T>(key: string): T | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
};

export const setDetailCache = <T>(
  key: string,
  data: T,
  ttlMs: number = DEFAULT_DETAIL_TTL_MS
) => {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
};
