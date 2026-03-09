import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, getDb, getWatchlistCardMetadataBatch } = vi.hoisted(() => ({
  auth: vi.fn(),
  getDb: vi.fn(),
  getWatchlistCardMetadataBatch: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("@/server/db/client", () => ({
  getDb,
}));

vi.mock("@/server/tmdb/watchlistCardMetadata", () => ({
  getWatchlistCardMetadataBatch,
}));

import { GET } from "@/app/api/watchlist/section-data/route";

function createQueryResult(result: unknown) {
  if (result instanceof Error) {
    return {
      orderBy: vi.fn(() => Promise.reject(result)),
      then: (_resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.reject(result).catch((error) => (reject ? reject(error) : Promise.reject(error))),
    };
  }

  return {
    orderBy: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result)),
  };
}

function createDbMock(selectResults: unknown[]) {
  let selectIndex = 0;

  const nextResult = () => selectResults[selectIndex++];

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => createQueryResult(nextResult())),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => createQueryResult(nextResult())),
        })),
      })),
    })),
  };
}

describe("GET /api/watchlist/section-data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
    getWatchlistCardMetadataBatch.mockResolvedValue(
      new Map([
        [
          "movie:10",
          {
            title: "Movie 10",
            year: "2026",
            releaseDate: "2026-03-01",
            posterPath: "/movie.jpg",
            isAnime: false,
            cachedAt: "2026-03-09T00:00:00.000Z",
            isStale: false,
          },
        ],
        [
          "tv:20",
          {
            title: "Show 20",
            year: "2026",
            releaseDate: null,
            posterPath: "/show.jpg",
            isAnime: true,
            cachedAt: "2026-03-09T00:00:00.000Z",
            isStale: false,
          },
        ],
      ])
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("movie 補充查詢失敗時仍保留主清單 rows", async () => {
    getDb.mockReturnValue(
      createDbMock([
        [
          {
            id: "item-1",
            tmdb_id: 10,
            media_type: "movie",
            is_anime: 0,
            created_at: new Date("2026-03-09T00:00:00.000Z"),
          },
        ],
        new Error("movie history failed"),
      ])
    );

    const response = await GET(
      new Request("http://localhost/api/watchlist/section-data?mediaType=movie")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      rows: [
        {
          id: "item-1",
          tmdb_id: 10,
          title: "Movie 10",
          year: "2026",
          release_date: "2026-03-01",
          tmdb_cached_at: "2026-03-09T00:00:00.000Z",
          tmdb_stale: false,
          poster_path: "/movie.jpg",
          media_type: "movie",
          is_anime: false,
          created_at: "2026-03-09T00:00:00.000Z",
        },
      ],
      movieHistoryRows: [],
    });
  });

  it("tv history 失敗時仍保留 tv states", async () => {
    getDb.mockReturnValue(
      createDbMock([
        [
          {
            id: "item-2",
            tmdb_id: 20,
            media_type: "tv",
            is_anime: 1,
            created_at: new Date("2026-03-09T00:00:00.000Z"),
          },
        ],
        new Error("tv history failed"),
        [
          {
            tmdb_id: 20,
            last_progress: "watching",
            last_total_aired: 12,
            last_watched_count: 5,
            checked_at: new Date("2026-03-09T08:00:00.000Z"),
          },
        ],
      ])
    );

    const response = await GET(
      new Request(
        "http://localhost/api/watchlist/section-data?mediaType=tv&isAnime=true"
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.latestEpisodes).toEqual({});
    expect(payload.watchedCounts).toEqual({});
    expect(payload.latestWatchedDates).toEqual({});
    expect(payload.tvStateRows).toEqual([
      {
        tmdb_id: 20,
        last_progress: "watching",
        last_total_aired: 12,
        last_watched_count: 5,
        alert_active: false,
        alert_notified_watch_count: 0,
        last_known_status: null,
        last_checked_at: "2026-03-09T08:00:00.000Z",
        alert_started_at: null,
      },
    ]);
  });

  it("tv state 失敗時仍保留觀看歷史摘要", async () => {
    getDb.mockReturnValue(
      createDbMock([
        [
          {
            id: "item-2",
            tmdb_id: 20,
            media_type: "tv",
            is_anime: 1,
            created_at: new Date("2026-03-09T00:00:00.000Z"),
          },
        ],
        [
          {
            id: "history-1",
            tmdbId: 20,
            seasonNumber: 1,
            episodeNumber: 3,
            watchedAt: new Date("2026-03-08T00:00:00.000Z"),
          },
        ],
        [],
        new Error("tv states failed"),
      ])
    );

    const response = await GET(
      new Request(
        "http://localhost/api/watchlist/section-data?mediaType=tv&isAnime=true"
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.latestEpisodes).toEqual({
      20: { season: 1, episode: 3 },
    });
    expect(payload.watchedCounts).toEqual({
      20: 1,
    });
    expect(payload.latestWatchedDates).toEqual({
      20: "2026-03-08",
    });
    expect(payload.tvStateRows).toEqual([]);
  });
});
