import { beforeEach, describe, expect, it, vi } from "vitest";

const { readManyTmdbCacheIncludingExpired } = vi.hoisted(() => ({
  readManyTmdbCacheIncludingExpired: vi.fn(),
}));

vi.mock("@/server/tmdb/cache", () => ({
  TMDB_CACHE_KEYS: {
    detail: (type: "movie" | "tv", id: string) => `tmdb:detail:${type}:${id}`,
  },
  readManyTmdbCacheIncludingExpired,
}));
vi.mock("@/server/tmdb/calendarMetadata", () => ({
  buildCalendarMetadataKey: (type: "movie" | "tv", id: number) =>
    `tmdb:calendar-meta:${type}:${id}`,
}));

import { getWatchlistCardMetadataBatch } from "@/server/tmdb/watchlistCardMetadata";

describe("getWatchlistCardMetadataBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("月曆 metadata 較新時會優先使用較新的標題", async () => {
    readManyTmdbCacheIncludingExpired
      .mockResolvedValueOnce(
        new Map([
          [
            "tmdb:detail:movie:10",
            {
              payload: {
                title: "Original Title",
                year: "2026",
                release_date: "2026-03-01",
              },
              updatedAt: new Date("2026-04-01T00:00:00.000Z"),
              expiresAt: new Date("2026-04-02T00:00:00.000Z"),
              expired: false,
            },
          ],
        ]),
      )
      .mockResolvedValueOnce(
        new Map([
          [
            "tmdb:calendar-meta:movie:10",
            {
              payload: {
                title: "中文片名",
                isAnime: false,
              },
              updatedAt: new Date("2026-04-02T00:00:00.000Z"),
              expiresAt: new Date("2026-09-01T00:00:00.000Z"),
              expired: false,
            },
          ],
        ]),
      );

    const result = await getWatchlistCardMetadataBatch([
      { type: "movie", tmdbId: 10 },
    ]);

    expect(result.get("movie:10")).toMatchObject({
      title: "中文片名",
      year: "2026",
      releaseDate: "2026-03-01",
    });
  });
});
