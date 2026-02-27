type WatchUpdateEvent = {
  reason: string;
  at: number;
};

type WatchUpdateListener = (event: WatchUpdateEvent) => void;

const listenersByUser = new Map<string, Set<WatchUpdateListener>>();

export function subscribeWatchUpdates(
  userId: string,
  listener: WatchUpdateListener
) {
  const listeners = listenersByUser.get(userId) ?? new Set<WatchUpdateListener>();
  listeners.add(listener);
  listenersByUser.set(userId, listeners);

  return () => {
    const current = listenersByUser.get(userId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listenersByUser.delete(userId);
    }
  };
}

export function publishWatchUpdates(userIds: string[], reason: string) {
  if (userIds.length === 0) return;
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return;
  const event: WatchUpdateEvent = { reason, at: Date.now() };
  unique.forEach((userId) => {
    const listeners = listenersByUser.get(userId);
    if (!listeners || listeners.size === 0) return;
    listeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // Ignore listener errors to avoid impacting publishers.
      }
    });
  });
}
