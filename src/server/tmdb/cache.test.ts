import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDb, readRedisJson, writeRedisJson } = vi.hoisted(() => ({
  getDb: vi.fn(),
  readRedisJson: vi.fn(),
  writeRedisJson: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getDb,
}));

vi.mock("@/server/realtime/redis", () => ({
  readRedisJson,
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

describe("readTmdbCache（Redis 優先）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeRedisJson.mockResolvedValue(true);
  });

  it("Redis 命中時直接回傳，不查 Neon", async () => {
    readRedisJson.mockResolvedValue({ title: "cached-from-redis" });

    const result = await readTmdbCache("tmdb:detail:movie:1");

    expect(result).toEqual({ title: "cached-from-redis" });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("Redis miss 時 fallback Neon，並用剩餘壽命回填 Redis（NX）", async () => {
    readRedisJson.mockResolvedValue(null);
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
    expect(writeRedisJson).toHaveBeenCalledWith(
      "tmdb-cache:tmdb:detail:movie:2",
      payload,
      expect.any(Number),
      { ifAbsent: true },
    );
  });

  it("Neon 資料已過期時回 null，且不回填 Redis", async () => {
    readRedisJson.mockResolvedValue(null);
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
    expect(writeRedisJson).not.toHaveBeenCalled();
  });
});

describe("writeTmdbCache（鏡像寫入 Redis）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeRedisJson.mockResolvedValue(true);
  });

  it("寫入 Neon 成功後，用相同 TTL 無條件鏡像寫入 Redis", async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    getDb.mockReturnValue({
      insert: vi.fn(() => ({ values })),
      execute: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    });

    await writeTmdbCache("tmdb:detail:movie:4", { title: "fresh" }, 60_000);

    expect(writeRedisJson).toHaveBeenCalledWith(
      "tmdb-cache:tmdb:detail:movie:4",
      { title: "fresh" },
      60_000,
    );
  });
});
