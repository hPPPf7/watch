import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  readManyTmdbCacheIncludingExpired,
  withTmdbInflight,
  withTmdbInflightGuarded,
  writeTmdbCache,
} = vi.hoisted(() => ({
  readManyTmdbCacheIncludingExpired: vi.fn(),
  withTmdbInflight: vi.fn(),
  withTmdbInflightGuarded: vi.fn(),
  writeTmdbCache: vi.fn(),
}));

vi.mock("@/server/tmdb/cache", () => ({
  readManyTmdbCacheIncludingExpired,
  TMDB_CACHE_TTL: { detail: 24 * 60 * 60 * 1000 },
  withTmdbInflight,
  withTmdbInflightGuarded,
  writeTmdbCache,
}));

import {
  buildCalendarMetadataKey,
  getCalendarMetadataBatch,
} from "@/server/tmdb/calendarMetadata";

describe("getCalendarMetadataBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TMDB_API_KEY;
  });

  it("一次讀完所有已快取作品，不逐 key 查 Neon", async () => {
    const expiresAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    readManyTmdbCacheIncludingExpired.mockResolvedValue(
      new Map([
        [
          buildCalendarMetadataKey("tv", 1399),
          {
            payload: {
              title: "權力遊戲",
              isAnime: false,
              titleNeedsRefresh: false,
            },
            expiresAt,
            updatedAt: new Date(),
            expired: false,
          },
        ],
        [
          buildCalendarMetadataKey("movie", 550),
          {
            payload: {
              title: "鬥陣俱樂部",
              isAnime: false,
              titleNeedsRefresh: false,
            },
            expiresAt,
            updatedAt: new Date(),
            expired: false,
          },
        ],
      ]),
    );

    const result = await getCalendarMetadataBatch([
      { mediaType: "tv", tmdbId: 1399 },
      { mediaType: "movie", tmdbId: 550 },
    ]);

    expect(readManyTmdbCacheIncludingExpired).toHaveBeenCalledTimes(1);
    expect(readManyTmdbCacheIncludingExpired).toHaveBeenCalledWith([
      buildCalendarMetadataKey("tv", 1399),
      buildCalendarMetadataKey("movie", 550),
    ]);
    expect(result.get("tv:1399")?.metadata.title).toBe("權力遊戲");
    expect(result.get("movie:550")?.metadata.title).toBe("鬥陣俱樂部");
    expect(result.get("tv:1399")?.refreshAfterMs).toBeGreaterThan(
      24 * 60 * 60 * 1000,
    );
    expect(withTmdbInflight).not.toHaveBeenCalled();
  });

  it("回傳剩餘 TTL，讓不完整標題按伺服器期限重查", async () => {
    const remainingMs = 3 * 60 * 60 * 1000;
    readManyTmdbCacheIncludingExpired.mockResolvedValue(
      new Map([
        [
          buildCalendarMetadataKey("tv", 1),
          {
            payload: {
              title: "Original title",
              isAnime: false,
              titleNeedsRefresh: true,
              titleRefreshAttempts: 1,
            },
            expiresAt: new Date(Date.now() + remainingMs),
            updatedAt: new Date(),
            expired: false,
          },
        ],
      ]),
    );

    const result = await getCalendarMetadataBatch([
      { mediaType: "tv", tmdbId: 1 },
    ]);
    const refreshAfterMs = result.get("tv:1")?.refreshAfterMs ?? 0;

    expect(refreshAfterMs).toBeGreaterThan(remainingMs - 5_000);
    expect(refreshAfterMs).toBeLessThanOrEqual(remainingMs);
  });

  it("缺少的項目沿用批次讀取結果，不再逐 key 回頭查 Neon", async () => {
    process.env.TMDB_API_KEY = "test-key";
    readManyTmdbCacheIncludingExpired.mockResolvedValue(new Map());
    withTmdbInflight.mockImplementation(
      async (_key: string, worker: () => Promise<unknown>) => worker(),
    );
    writeTmdbCache.mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              name: "Original title",
              original_name: "Original title",
              original_language: "en",
              genres: [],
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              name: "Original title",
              original_name: "Original title",
              original_language: "en",
              genres: [],
            }),
            { status: 200 },
          ),
        ),
    );

    const result = await getCalendarMetadataBatch([
      { mediaType: "tv", tmdbId: 1 },
    ]);

    expect(readManyTmdbCacheIncludingExpired).toHaveBeenCalledTimes(1);
    expect(result.get("tv:1")?.metadata.title).toBe("Original title");
    expect(writeTmdbCache).toHaveBeenCalledTimes(1);
  });
});
