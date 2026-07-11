import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL?.trim() ?? "";

function requireRedisUrl() {
  if (!REDIS_URL) {
    throw new Error("REDIS_URL is required for Redis realtime transport");
  }
  return REDIS_URL;
}

function createPublisherClient(connectionName: string) {
  const client = new Redis(requireRedisUrl(), {
    connectionName,
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    commandTimeout: 1000,
  });
  attachErrorListener(client);
  return client;
}

function createSubscriberClient(connectionName: string) {
  const client = new Redis(requireRedisUrl(), {
    connectionName,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
  });
  attachErrorListener(client);
  return client;
}

function attachErrorListener(client: Redis) {
  // Redis 短暫離線時 ioredis 會 emit 'error'；沒有 listener 會變成
  // unhandled error event 讓整個行程崩潰。指令層的失敗仍會以
  // rejected promise 回到呼叫端，由各自的 fallback 邏輯處理。
  client.on("error", () => {});
}

export function isRedisRealtimeEnabled() {
  return REDIS_URL.length > 0;
}

export function getRedisPublisher() {
  const globalState = globalThis as typeof globalThis & {
    __watchRedisPublisher?: Redis;
  };
  if (!globalState.__watchRedisPublisher) {
    globalState.__watchRedisPublisher = createPublisherClient(
      "watch-realtime-publisher",
    );
  }
  return globalState.__watchRedisPublisher;
}

export function getRedisSubscriber() {
  const globalState = globalThis as typeof globalThis & {
    __watchRedisSubscriber?: Redis;
  };
  if (!globalState.__watchRedisSubscriber) {
    globalState.__watchRedisSubscriber = createSubscriberClient(
      "watch-realtime-subscriber",
    );
  }
  return globalState.__watchRedisSubscriber;
}

// 短命 KV（revision 簽章、latest watch update 這類 TTL 只有數秒到一天的 key）
// 的共用存取。刻意回傳 null / false 而不是丟錯：Redis 只是快取層，
// 失敗時呼叫端一律 fallback 到 DB 路徑。
export async function readRedisJson<T>(key: string): Promise<T | null> {
  if (!isRedisRealtimeEnabled()) return null;
  try {
    const raw = await getRedisPublisher().get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeRedisJson(
  key: string,
  value: unknown,
  ttlMs: number,
  options?: { ifAbsent?: boolean },
): Promise<boolean> {
  if (!isRedisRealtimeEnabled()) return false;
  const ttl = Math.floor(ttlMs);
  if (!Number.isFinite(ttl) || ttl <= 0) return false;
  try {
    const serialized = JSON.stringify(value);
    if (options?.ifAbsent) {
      // NX：只在 key 不存在時寫入，用於「從 DB 回填」的場景，
      // 避免回填的舊資料蓋掉併發寫入的新紀錄。
      await getRedisPublisher().set(key, serialized, "PX", ttl, "NX");
    } else {
      await getRedisPublisher().set(key, serialized, "PX", ttl);
    }
    return true;
  } catch {
    return false;
  }
}
