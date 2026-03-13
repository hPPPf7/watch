import { readLatestWatchUpdate } from "@/server/realtime/watchUpdates";

type WatchUpdateRecord = {
  reason: string;
  at: number;
  nonce: string;
};

type WatchUpdateSubscriber = (record: WatchUpdateRecord) => void;

type SharedPollerEntry = {
  subscribers: Set<WatchUpdateSubscriber>;
  timer: ReturnType<typeof setInterval> | null;
  inFlight: boolean;
  lastNonce: string | null;
  lastRecord: WatchUpdateRecord | null;
};

const WATCH_UPDATE_POLL_INTERVAL_MS = 3000;

const getPollerStore = () => {
  const globalState = globalThis as typeof globalThis & {
    __watchUpdateSharedPollers?: Map<string, SharedPollerEntry>;
  };
  if (!globalState.__watchUpdateSharedPollers) {
    globalState.__watchUpdateSharedPollers = new Map();
  }
  return globalState.__watchUpdateSharedPollers;
};

const stopPollerIfUnused = (userId: string, entry: SharedPollerEntry) => {
  if (entry.subscribers.size > 0) {
    return;
  }
  if (entry.timer) {
    clearInterval(entry.timer);
  }
  const store = getPollerStore();
  if (store.get(userId) === entry) {
    store.delete(userId);
  }
};

const emitToSubscribers = (entry: SharedPollerEntry, record: WatchUpdateRecord) => {
  entry.subscribers.forEach((subscriber) => {
    try {
      subscriber(record);
    } catch {
      // 單一 SSE 連線失敗時只忽略該 listener，不中斷其他連線。
    }
  });
};

const pollLatestWatchUpdate = async (userId: string, entry: SharedPollerEntry) => {
  if (entry.inFlight || entry.subscribers.size === 0) {
    return;
  }
  entry.inFlight = true;
  try {
    const record = await readLatestWatchUpdate(userId);
    if (!record) {
      entry.lastRecord = null;
      entry.lastNonce = null;
      return;
    }
    entry.lastRecord = record;
    if (record.nonce === entry.lastNonce) {
      return;
    }
    entry.lastNonce = record.nonce;
    emitToSubscribers(entry, record);
  } catch {
    // 暫時性的資料庫錯誤先忽略，下一次輪詢會再重試。
  } finally {
    entry.inFlight = false;
    stopPollerIfUnused(userId, entry);
  }
};

const getOrCreatePollerEntry = (userId: string) => {
  const store = getPollerStore();
  const existing = store.get(userId);
  if (existing) {
    return existing;
  }
  const entry: SharedPollerEntry = {
    subscribers: new Set(),
    timer: null,
    inFlight: false,
    lastNonce: null,
    lastRecord: null,
  };
  entry.timer = setInterval(() => {
    void pollLatestWatchUpdate(userId, entry);
  }, WATCH_UPDATE_POLL_INTERVAL_MS);
  store.set(userId, entry);
  return entry;
};

export function subscribeToSharedWatchUpdatePoller(
  userId: string,
  subscriber: WatchUpdateSubscriber,
) {
  const entry = getOrCreatePollerEntry(userId);
  entry.subscribers.add(subscriber);
  if (entry.lastRecord) {
    subscriber(entry.lastRecord);
  } else {
    void pollLatestWatchUpdate(userId, entry);
  }

  return () => {
    entry.subscribers.delete(subscriber);
    stopPollerIfUnused(userId, entry);
  };
}

export function getSharedWatchUpdatePollIntervalMs() {
  return WATCH_UPDATE_POLL_INTERVAL_MS;
}
