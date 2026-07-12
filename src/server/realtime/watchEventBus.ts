import {
  getRedisPublisher,
  getRedisSubscriber,
  isRedisRealtimeEnabled,
} from "@/server/realtime/redis";

export type WatchUpdateEvent = {
  userId: string;
  reason: string;
  at: number;
  nonce: string;
};

type WatchUpdateHandler = (event: WatchUpdateEvent) => void;

type RedisSubscriptionEntry = {
  handlers: Set<WatchUpdateHandler>;
  refCount: number;
  subscribed: boolean;
  operation: Promise<void>;
};

const WATCHLIST_CHANNEL_PREFIX = "watchlist:user:";

const watchChannel = (userId: string) => `${WATCHLIST_CHANNEL_PREFIX}${userId}`;

function queueOperation(
  entry: RedisSubscriptionEntry,
  operation: () => Promise<void>,
) {
  entry.operation = entry.operation
    .catch(() => {})
    .then(operation);
  return entry.operation;
}

function rollbackSubscription(
  store: Map<string, RedisSubscriptionEntry>,
  userId: string,
  entry: RedisSubscriptionEntry,
  handler: WatchUpdateHandler,
) {
  entry.handlers.delete(handler);
  entry.refCount -= 1;
  if (store.get(userId) === entry && entry.refCount === 0) {
    store.delete(userId);
  }
}

function getRedisSubscriptionStore() {
  const globalState = globalThis as typeof globalThis & {
    __watchRedisSubscriptionStore?: Map<string, RedisSubscriptionEntry>;
    __watchRedisMessageHandlerAttached?: boolean;
  };
  if (!globalState.__watchRedisSubscriptionStore) {
    globalState.__watchRedisSubscriptionStore = new Map();
  }
  if (!globalState.__watchRedisMessageHandlerAttached) {
    const subscriber = getRedisSubscriber();
    subscriber.on("message", (channel, rawMessage) => {
      if (!channel.startsWith(WATCHLIST_CHANNEL_PREFIX)) return;
      const userId = channel.slice(WATCHLIST_CHANNEL_PREFIX.length);
      const entry = globalState.__watchRedisSubscriptionStore?.get(userId);
      if (!entry) return;
      try {
        const event = JSON.parse(rawMessage) as WatchUpdateEvent;
        entry.handlers.forEach((handler) => {
          try {
            handler(event);
          } catch {
            // Ignore single listener failures so other SSE clients still receive updates.
          }
        });
      } catch {
        // Ignore malformed payloads.
      }
    });
    globalState.__watchRedisMessageHandlerAttached = true;
  }
  return globalState.__watchRedisSubscriptionStore;
}

let transportModeLogged = false;

export function getWatchUpdateTransportMode() {
  const mode = isRedisRealtimeEnabled() ? "redis" : "polling";
  // 每個行程只記一次，讓部署後可以從 log 確認 realtime 走的是
  // Redis Pub/Sub 還是 shared poller fallback。
  if (!transportModeLogged) {
    transportModeLogged = true;
    console.info("[realtime] watchlist transport mode:", mode);
  }
  return mode;
}

export async function publishWatchUpdateEvent(event: WatchUpdateEvent) {
  if (!isRedisRealtimeEnabled()) {
    return;
  }
  await getRedisPublisher().publish(watchChannel(event.userId), JSON.stringify(event));
}

export async function subscribeToWatchUpdateEvents(
  userId: string,
  handler: WatchUpdateHandler,
) {
  if (!isRedisRealtimeEnabled()) {
    throw new Error("Redis realtime transport is not enabled");
  }

  const store = getRedisSubscriptionStore();
  const existing = store.get(userId);
  if (existing) {
    existing.handlers.add(handler);
    existing.refCount += 1;
    try {
      await queueOperation(existing, async () => {
        if (existing.subscribed) return;
        await getRedisSubscriber().subscribe(watchChannel(userId));
        existing.subscribed = true;
      });
    } catch (error) {
      // 訂閱失敗必須回滾 handler / refCount，否則呼叫端拿不到 unsubscribe，
      // refCount 永久多計、handler 閉包永久洩漏、channel 永不退訂。
      rollbackSubscription(store, userId, existing, handler);
      throw error;
    }
    return async () => {
      existing.handlers.delete(handler);
      existing.refCount -= 1;
      await queueOperation(existing, async () => {
        if (existing.refCount > 0 || !existing.subscribed) return;
        await getRedisSubscriber().unsubscribe(watchChannel(userId));
        existing.subscribed = false;
        if (store.get(userId) === existing && existing.refCount === 0) {
          store.delete(userId);
        }
      });
    };
  }

  const entry: RedisSubscriptionEntry = {
    handlers: new Set([handler]),
    refCount: 1,
    subscribed: false,
    operation: Promise.resolve(),
  };
  store.set(userId, entry);
  const subscriber = getRedisSubscriber();
  try {
    await queueOperation(entry, async () => {
      if (entry.subscribed) return;
      await subscriber.subscribe(watchChannel(userId));
      entry.subscribed = true;
    });
  } catch (error) {
    // 只回滾自己這筆；若有併發訂閱者已加入同一 entry（refCount > 1），
    // 不可整筆刪除，否則會把對方的訂閱一起從 store 移除。
    rollbackSubscription(store, userId, entry, handler);
    throw error;
  }

  return async () => {
    const current = store.get(userId);
    if (!current) return;
    current.handlers.delete(handler);
    current.refCount -= 1;
    await queueOperation(current, async () => {
      if (current.refCount > 0 || !current.subscribed) return;
      await subscriber.unsubscribe(watchChannel(userId));
      current.subscribed = false;
      if (store.get(userId) === current && current.refCount === 0) {
        store.delete(userId);
      }
    });
  };
}
