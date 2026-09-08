export function clearWatchUserCache(userId: string) {
  if (typeof window === "undefined" || !userId) return;
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of Object.keys(storage)) {
      if (key.startsWith("watchlist:") && key.includes(`:${userId}:`)) storage.removeItem(key);
    }
  }
}
