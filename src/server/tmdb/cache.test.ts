import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDb, readThroughRedis, writeRedisJson } = vi.hoisted(() => ({
  getDb: vi.fn(),
  readThroughRedis: vi.fn(),
  writeRedisJson: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getDb,
}));

vi.mock("@/server/realtime/redis", () => ({
  readThroughRedis,
  writeRedisJson,
}));

import {
  getRecommendationsTtlMs,
  withTmdbInflightGuarded,
  readTmdbCache,
  writeTmdbCache,
} from "@/server/tmdb/cache";

describe("getRecommendationsTtlMs", () => {
  it("expires recommendations at the next 05:00 Taipei refresh window", () => {
    expect(
      getRecommendationsTtlMs(new Date("2026-06-16T09:10:00.000Z")),
    ).toBe(11 * 60 * 60 * 1000 + 50 * 60 * 1000);
  });

  it("uses today's refresh window before 05:00 Taipei", () => {
    expect(
      getRecommendationsTtlMs(new Date("2026-06-16T20:30:00.000Z")),
    ).toBe(30 * 60 * 1000);
  });
});

// readThroughRedis 本身的 Redis 命中 / miss / NX 回填邏輯已經在
// src/server/realtime/redis.test.ts 用真實實作 + 假 ioredis 測過；
// 這裡只測 readTmdbCache 傳給它的 redisKey 前綴，以及傳入的
// loadFromSource callback（查 Neon 那段）是否正確。mock 用一個簡化的
// passthrough：直接呼叫 loadFromSource 並回傳其 payload，藉此驗證
// callback 本身的行為，不重複測 readThroughRedis 的內部邏輯。
describe("readTmdbCache（Redis 優先）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readThroughRedis.mockImplementation(async (_redisKey, loadFromSource) => {
      const sourceResult = await loadFromSource();
      return sourceResult ? sourceResult.payload : null;
    });
  });

  it("用 tmdb-cache: 前綴呼叫 readThroughRedis，避免跟其他子系統的 key 撞名", async () => {
    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
        })),
      })),
    });

    await readTmdbCache("tmdb:detail:movie:1");

    expect(readThroughRedis).toHaveBeenCalledWith(
      "tmdb-cache:tmdb:detail:movie:1",
      expect.any(Function),
    );
  });

  it("loadFromSource 查到未過期的 Neon 資料時，回傳 payload 與剩餘壽命", async () => {
    const payload = { title: "cached-from-neon" };
    const limit = vi.fn().mockResolvedValue([
      {
        payload,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        updatedAt: new Date(),
      },
    ]);
    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })),
      })),
    });

    const result = await readTmdbCache("tmdb:detail:movie:2");

    expect(result).toEqual(payload);
    const loadFromSource = readThroughRedis.mock.calls[0][1];
    const sourceResult = await loadFromSource();
    expect(sourceResult.payload).toEqual(payload);
    expect(sourceResult.remainingTtlMs).toBeGreaterThan(0);
    expect(sourceResult.remainingTtlMs).toBeLessThanOrEqual(60_000);
  });

  it("loadFromSource 查到已過期的 Neon 資料時回傳 null", async () => {
    const limit = vi.fn().mockResolvedValue([
      {
        payload: { title: "stale" },
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
        updatedAt: new Date(),
      },
    ]);
    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })),
      })),
    });

    const result = await readTmdbCache("tmdb:detail:movie:3");

    expect(result).toBeNull();
  });

  it("loadFromSource 沒有資料庫連線時回傳 null，不拋錯", async () => {
    getDb.mockImplementation(() => {
      throw new Error("DATABASE_URL_MISSING");
    });

    const result = await readTmdbCache("tmdb:detail:movie:4");

    expect(result).toBeNull();
  });
});

describe("writeTmdbCache（鏡像寫入 Redis）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeRedisJson.mockResolvedValue(true);
  });

  function createInsertDbMock() {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    return {
      insert: vi.fn(() => ({ values })),
      execute: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    };
  }

  it("寫入 Neon 成功後，用相同 TTL 無條件鏡像寫入 Redis", async () => {
    getDb.mockReturnValue(createInsertDbMock());

    await writeTmdbCache("tmdb:detail:movie:5", { title: "fresh" }, 60_000);

    expect(writeRedisJson).toHaveBeenCalledWith(
      "tmdb-cache:tmdb:detail:movie:5",
      { title: "fresh" },
      60_000,
    );
  });

  it("skipRedisMirror 為 true 時，不鏡像寫入 Redis（給非 TMDB 資料用）", async () => {
    getDb.mockReturnValue(createInsertDbMock());

    await writeTmdbCache(
      "watch:cron:tmdb-cache-cleanup:last-run",
      { ok: true },
      60_000,
      { skipRedisMirror: true },
    );

    expect(writeRedisJson).not.toHaveBeenCalled();
  });
});

describe("withTmdbInflightGuarded", () => {
  it("單一限流拒絕不留下 unhandled rejection，後續可重試", async () => {
    const factory = vi.fn();
    await expect(withTmdbInflightGuarded("denied", () => { throw new Error("RATE_LIMITED"); }, factory)).rejects.toThrow("RATE_LIMITED");
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(factory).not.toHaveBeenCalled();
    await expect(withTmdbInflightGuarded("denied", () => {}, async () => 42)).resolves.toBe(42);
  });
  it("等待同 key 失敗啟動後仍須通過自己的限流", async () => {
    let reject!: (error: Error) => void;
    const first = withTmdbInflightGuarded("waiting", () => new Promise<void>((_, no) => { reject = no; }), async () => 1);
    const check = vi.fn(() => { throw new Error("RATE_LIMITED"); });
    const second = withTmdbInflightGuarded("waiting", check, async () => 2);
    const failures = Promise.allSettled([first, second]);
    reject(new Error("RATE_LIMITED"));
    expect((await failures).map(r => r.status)).toEqual(["rejected", "rejected"]);
    expect(check).toHaveBeenCalledOnce();
  });
  it("成功啟動的同 key 請求只打一次 upstream", async () => {
    let resolve!: (value: number) => void;
    const factory = vi.fn(() => new Promise<number>(yes => { resolve = yes; }));
    const first = withTmdbInflightGuarded("shared", () => {}, factory);
    await Promise.resolve();
    const check = vi.fn();
    const second = withTmdbInflightGuarded("shared", check, factory);
    resolve(7);
    expect(await Promise.all([first, second])).toEqual([7, 7]);
    expect(factory).toHaveBeenCalledOnce(); expect(check).not.toHaveBeenCalled();
  });
});
