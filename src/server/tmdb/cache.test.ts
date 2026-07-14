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
