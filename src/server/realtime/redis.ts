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
  // rejected promise 回到呼叫端，由各自的 fallback 邏輯處理；
  // 這裡只留節流後的警告，方便維運確認 Redis 連線是否健康。
  client.on("error", (error) => {
    warnRedisDegraded("connection", "connection", error);
  });
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

// Redis 降級是刻意「不吭聲、走 fallback」的設計，但完全靜默會讓維運
// 無法分辨「Redis 正常運作」和「其實一直在 fallback 回 DB」。
// 這裡以節流方式（每個 namespace 最多每 5 分鐘一次）留下警告，不干擾功能。
//
// 節流是「每個 namespace 各自一個計時器」，不是全站共用一個：TMDB 快取
// 這類高頻讀寫跟 revision / watch-update 這類低頻讀寫共用同一組
// readRedisJson/writeRedisJson，若只用單一計時器，量大的 namespace 會
// 一直「搶到」警告額度，量小的 namespace 降級時反而看不到任何警告。
const KV_DEGRADED_WARN_THROTTLE_MS = 5 * 60 * 1000;
const lastKvDegradedWarnAtByNamespace = new Map<string, number>();

// 從 key 推導一個粗略的 namespace 做警告分桶（例如 "tmdb-cache:tmdb"、
// "watch:updates"、"watch:revision-state"），不要求語意完美，只要能把
// 不同子系統的降級警告分開顯示即可。
function deriveNamespace(key: string) {
  return key.split(":").slice(0, 2).join(":") || key;
}

function warnRedisDegraded(operation: string, key: string, error: unknown) {
  const namespace = deriveNamespace(key);
  const now = Date.now();
  const lastWarnAt = lastKvDegradedWarnAtByNamespace.get(namespace) ?? 0;
  if (now - lastWarnAt < KV_DEGRADED_WARN_THROTTLE_MS) return;
  lastKvDegradedWarnAtByNamespace.set(namespace, now);
  console.warn("[realtime/redis] Redis 操作失敗，已 fallback 到 DB 路徑", {
    operation,
    namespace,
    error,
  });
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
  } catch (error) {
    warnRedisDegraded("kv-read", key, error);
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
  } catch (error) {
    warnRedisDegraded("kv-write", key, error);
    return false;
  }
}

// 共用的「Redis 優先、miss 時回源（通常是 DB）、用剩餘壽命 NX 回填」
// read-through helper。cache.ts 的 readTmdbCache 用這個實作；
// watchUpdates.ts / watchlistRevisionService.ts 的 Redis-first 邏輯
// 目前仍各自手寫（前者呼叫形狀略有不同、後者在 Redis 啟用時完全不
// fallback DB cache，語意不同），先不強行套用同一個 helper。
export async function readThroughRedis<T>(
  redisKey: string,
  loadFromSource: () => Promise<{ payload: T; remainingTtlMs: number } | null>,
): Promise<T | null> {
  const cachedFromRedis = await readRedisJson<T>(redisKey);
  if (cachedFromRedis !== null) return cachedFromRedis;

  // loadFromSource 理論上該自己 catch（目前唯一的呼叫端 cache.ts 就是這樣
  // 做），但這裡是共用 helper，未來的呼叫端可能忘記包 try/catch；一旦漏接
  // 就會讓「Redis 降級一律安靜 fallback」這個整個模組的核心保證破功，變成
  // 直接把來源查詢的例外丟給呼叫端。這裡兜底 catch 一次，把它也當成
  // cache miss 處理，並記錄警告方便追查。
  let sourceResult: { payload: T; remainingTtlMs: number } | null;
  try {
    sourceResult = await loadFromSource();
  } catch (error) {
    console.warn("[realtime/redis] readThroughRedis 的 loadFromSource 失敗", {
      redisKey,
      error,
    });
    return null;
  }
  if (!sourceResult) return null;

  void writeRedisJson(
    redisKey,
    sourceResult.payload,
    sourceResult.remainingTtlMs,
    { ifAbsent: true },
  );
  return sourceResult.payload;
}
