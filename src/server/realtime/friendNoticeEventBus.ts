import {
  getRedisPublisher,
  getRedisSubscriber,
  isRedisRealtimeEnabled,
} from "@/server/realtime/redis";

export type FriendNoticeEvent = {
  userId: string;
  reason: string;
  at: number;
};

type FriendNoticeHandler = (event: FriendNoticeEvent) => void;

type RedisSubscriptionEntry = {
  handlers: Set<FriendNoticeHandler>;
  refCount: number;
  subscribed: boolean;
  operation: Promise<void>;
};

const FRIEND_NOTICE_CHANNEL_PREFIX = "friend-notice:user:";

const friendNoticeChannel = (userId: string) =>
  `${FRIEND_NOTICE_CHANNEL_PREFIX}${userId}`;

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
  handler: FriendNoticeHandler,
) {
  entry.handlers.delete(handler);
  entry.refCount -= 1;
  if (store.get(userId) === entry && entry.refCount === 0) {
    store.delete(userId);
  }
}

function getRedisSubscriptionStore() {
  const globalState = globalThis as typeof globalThis & {
    __friendNoticeRedisSubscriptionStore?: Map<string, RedisSubscriptionEntry>;
    __friendNoticeRedisMessageHandlerAttached?: boolean;
  };
  if (!globalState.__friendNoticeRedisSubscriptionStore) {
    globalState.__friendNoticeRedisSubscriptionStore = new Map();
  }
  if (!globalState.__friendNoticeRedisMessageHandlerAttached) {
    const subscriber = getRedisSubscriber();
    subscriber.on("message", (channel, rawMessage) => {
      if (!channel.startsWith(FRIEND_NOTICE_CHANNEL_PREFIX)) return;
      const userId = channel.slice(FRIEND_NOTICE_CHANNEL_PREFIX.length);
      const entry = globalState.__friendNoticeRedisSubscriptionStore?.get(userId);
      if (!entry) return;
      try {
        const event = JSON.parse(rawMessage) as FriendNoticeEvent;
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
    globalState.__friendNoticeRedisMessageHandlerAttached = true;
  }
  return globalState.__friendNoticeRedisSubscriptionStore;
}

export function getFriendNoticeTransportMode() {
  return isRedisRealtimeEnabled() ? "redis" : "polling";
}

export async function publishFriendNoticeEvent(event: FriendNoticeEvent) {
  if (!isRedisRealtimeEnabled()) {
    return;
  }
  await getRedisPublisher().publish(
    friendNoticeChannel(event.userId),
    JSON.stringify(event),
  );
}

export async function publishFriendNoticeUpdates(
  userIds: string[],
  reason: string,
) {
  const normalizedUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (normalizedUserIds.length === 0) return;
  const at = Date.now();
  await Promise.all(
    normalizedUserIds.map((userId) =>
      publishFriendNoticeEvent({
        userId,
        reason,
        at,
      }),
    ),
  );
}

export async function subscribeToFriendNoticeEvents(
  userId: string,
  handler: FriendNoticeHandler,
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
        await getRedisSubscriber().subscribe(friendNoticeChannel(userId));
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
        await getRedisSubscriber().unsubscribe(friendNoticeChannel(userId));
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
      await subscriber.subscribe(friendNoticeChannel(userId));
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
      await subscriber.unsubscribe(friendNoticeChannel(userId));
      current.subscribed = false;
      if (store.get(userId) === current && current.refCount === 0) {
        store.delete(userId);
      }
    });
  };
}
