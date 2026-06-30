type WatchlistScope = {
  userId: string;
  mediaType: "movie" | "tv";
  isAnime: boolean;
};

const dirtyKey = ({ userId, mediaType, isAnime }: WatchlistScope) =>
  `watchlist:dirty:${userId}:${mediaType}:${isAnime}`;

export const getWatchlistDirtyMarker = (scope: WatchlistScope) => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(dirtyKey(scope));
  } catch {
    return null;
  }
};

export const markWatchlistDirty = (
  scope: WatchlistScope,
  affectedIsAnime: boolean[] = [scope.isAnime],
) => {
  if (typeof window === "undefined" || !scope.userId) return;
  const scopes =
    scope.mediaType === "tv"
      ? Array.from(new Set(affectedIsAnime)).map((isAnime) => ({
          ...scope,
          isAnime,
        }))
      : [{ ...scope, isAnime: false }];
  scopes.forEach((affectedScope) => {
    const marker = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    try {
      window.localStorage.setItem(dirtyKey(affectedScope), marker);
    } catch {
      // Storage availability must not affect the successful server mutation.
    }
  });
};

export const clearWatchlistDirtyMarker = (
  scope: WatchlistScope,
  expectedMarker: string,
) => {
  if (typeof window === "undefined") return;
  try {
    const key = dirtyKey(scope);
    if (window.localStorage.getItem(key) === expectedMarker) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage availability must not affect the successful server mutation.
  }
};
