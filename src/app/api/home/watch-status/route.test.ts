import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, getDb, selectLatestWatchlistTvStates } = vi.hoisted(() => ({
  auth: vi.fn(),
  getDb: vi.fn(),
  selectLatestWatchlistTvStates: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("@/server/db/client", () => ({
  getDb,
}));

vi.mock("@/server/services/watchlistTvStateService", () => ({
  selectLatestWatchlistTvStates,
}));

import { POST } from "@/app/api/home/watch-status/route";

function createDbMock(selectResults: unknown[]) {
  let selectIndex = 0;
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(selectResults[selectIndex++] ?? [])),
      })),
    })),
  };
}

describe("POST /api/home/watch-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("優先使用最新 TV state，剩餘作品才回退到觀看歷史", async () => {
    const db = createDbMock([
      [{ tmdbId: 1 }],
      [{ tmdbId: 3, seasonNumber: 1, episodeNumber: 2 }],
    ]);
    getDb.mockReturnValue(db);
    selectLatestWatchlistTvStates.mockResolvedValue([
      {
        id: "state-2",
        tmdb_id: 2,
        last_progress: "completed",
        last_total_aired: 12,
        last_watched_count: 12,
        checked_at: null,
        updated_at: "2026-03-09T00:00:00.000Z",
      },
    ]);

    const response = await POST(
      new Request("http://localhost/api/home/watch-status", {
        method: "POST",
        body: JSON.stringify({
          movieIds: [1],
          tvIds: [2, 3],
          animeIds: [],
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(selectLatestWatchlistTvStates).toHaveBeenCalledWith(
      db,
      "user-1",
      [2, 3]
    );
    expect(payload).toEqual({
      statusMap: {
        "movie:series:1": "completed",
        "tv:series:2": "completed",
        "tv:series:3": "watching",
      },
    });
  });

  it("TV state 只會寫回請求對應的分區", async () => {
    const db = createDbMock([[]]);
    getDb.mockReturnValue(db);
    selectLatestWatchlistTvStates.mockResolvedValue([
      {
        id: "state-9",
        tmdb_id: 9,
        last_progress: "watching",
        last_total_aired: 12,
        last_watched_count: 3,
        checked_at: null,
        updated_at: "2026-03-09T00:00:00.000Z",
      },
    ]);

    const response = await POST(
      new Request("http://localhost/api/home/watch-status", {
        method: "POST",
        body: JSON.stringify({
          movieIds: [],
          tvIds: [],
          animeIds: [9],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      statusMap: {
        "tv:anime:9": "watching",
      },
    });
  });

  it("遇到非法 ID 陣列時回 BAD_REQUEST", async () => {
    getDb.mockReturnValue(createDbMock([]));

    const response = await POST(
      new Request("http://localhost/api/home/watch-status", {
        method: "POST",
        body: JSON.stringify({
          movieIds: [1, -2],
          tvIds: ["3"],
          animeIds: [],
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "BAD_REQUEST",
      message: "Invalid payload",
    });
    expect(selectLatestWatchlistTvStates).not.toHaveBeenCalled();
  });
});
