import { describe, expect, it, vi } from "vitest";

// 用最小的假 ioredis client 測 readThroughRedis 的真實邏輯（不是 mock
// readRedisJson/writeRedisJson 本身）：這支 helper 內部呼叫的是同模組
// 的 function binding，跨模組 vi.mock 覆寫不到，只能在更底層（ioredis）
// 假掉，才測得到 readThroughRedis 真正的行為。
class FakeRedisClient {
  store = new Map<string, { value: string; expiresAt: number }>();
  on() {}
  async get(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }
  async set(key: string, value: string, ...args: unknown[]) {
    const pxIndex = args.indexOf("PX");
    const ttl = pxIndex >= 0 ? Number(args[pxIndex + 1]) : 10_000;
    const nx = args.includes("NX");
    if (nx && this.store.has(key)) return null;
    this.store.set(key, { value, expiresAt: Date.now() + ttl });
    return "OK";
  }
}

vi.mock("ioredis", () => ({ default: FakeRedisClient }));

process.env.REDIS_URL = "rediss://fake:fake@fake.upstash.io:6379";

const { readThroughRedis, readRedisJson, writeRedisJson } = await import(
  "@/server/realtime/redis"
);

describe("readThroughRedis", () => {
  it("Redis 命中時直接回傳，不呼叫 loadFromSource", async () => {
    const key = `test:hit:${Math.random()}`;
    await writeRedisJson(key, { value: "cached" }, 60_000);
    const loadFromSource = vi.fn();

    const result = await readThroughRedis(key, loadFromSource);

    expect(result).toEqual({ value: "cached" });
    expect(loadFromSource).not.toHaveBeenCalled();
  });

  it("Redis miss 時呼叫 loadFromSource，並用回傳的剩餘壽命回填 Redis", async () => {
    const key = `test:miss-backfill:${Math.random()}`;
    const loadFromSource = vi.fn().mockResolvedValue({
      payload: { value: "from-source" },
      remainingTtlMs: 60_000,
    });

    const result = await readThroughRedis(key, loadFromSource);

    expect(result).toEqual({ value: "from-source" });
    expect(loadFromSource).toHaveBeenCalledTimes(1);

    const backfilled = await readRedisJson(key);
    expect(backfilled).toEqual({ value: "from-source" });
  });

  it("loadFromSource 回傳 null 時整體回傳 null，且不寫入 Redis", async () => {
    const key = `test:miss-null:${Math.random()}`;
    const loadFromSource = vi.fn().mockResolvedValue(null);

    const result = await readThroughRedis(key, loadFromSource);

    expect(result).toBeNull();
    const afterward = await readRedisJson(key);
    expect(afterward).toBeNull();
  });

  it("回填使用 NX，不會覆蓋掉 loadFromSource 執行期間被搶先寫入的新資料", async () => {
    const key = `test:nx-backfill:${Math.random()}`;
    const loadFromSource = vi.fn().mockImplementation(async () => {
      // 模擬「另一個請求在這次 loadFromSource 還在跑的時候，搶先把
      // 更新的資料寫進了 Redis」——這是 NX 要保護的真實競態場景。
      await writeRedisJson(key, { value: "concurrent-fresh" }, 60_000);
      return {
        payload: { value: "stale-from-source" },
        remainingTtlMs: 60_000,
      };
    });

    const result = await readThroughRedis(key, loadFromSource);

    // 這次呼叫仍拿到自己實際查到的資料，不受競態影響。
    expect(result).toEqual({ value: "stale-from-source" });
    // 但 Redis 裡應該保留「搶先寫入」的新資料，不被回填蓋掉。
    const current = await readRedisJson(key);
    expect(current).toEqual({ value: "concurrent-fresh" });
  });

  it("loadFromSource 拋出例外時回傳 null，不讓例外往外傳", async () => {
    const key = `test:source-throws:${Math.random()}`;
    const loadFromSource = vi.fn().mockRejectedValue(new Error("db down"));

    const result = await readThroughRedis(key, loadFromSource);

    expect(result).toBeNull();
    const afterward = await readRedisJson(key);
    expect(afterward).toBeNull();
  });
});
