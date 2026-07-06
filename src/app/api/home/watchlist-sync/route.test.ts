import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, getDb, runInTransaction, publishScopedWatchUpdates } = vi.hoisted(() => ({
  auth: vi.fn(),
  getDb: vi.fn(),
  runInTransaction: vi.fn(),
  publishScopedWatchUpdates: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("@/server/db/client", () => ({
  getDb,
  runInTransaction,
}));

vi.mock("@/server/realtime/watchUpdates", () => ({
  publishScopedWatchUpdates,
}));

import { POST } from "@/app/api/home/watchlist-sync/route";

function createDbMock(selectResults: unknown[]) {
  let selectIndex = 0;
  return {
    execute: vi.fn(() => Promise.resolve()),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(selectResults[selectIndex++])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(),
    })),
  };
}

describe("POST /api/home/watchlist-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
    runInTransaction.mockImplementation(async (callback) =>
      callback(getDb.mock.results.at(-1)?.value ?? getDb()),
    );
  });

  it("同步分類時會收斂同作品的重複 TV rows", async () => {
    const db = createDbMock([
      [
        { id: "tv-normal", isAnime: 0 },
        { id: "tv-anime", isAnime: 1 },
      ],
    ]);
    getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/home/watchlist-sync", {
        method: "POST",
        body: JSON.stringify({
          item: {
            type: "tv",
            id: 42,
            title: "Show",
            year: null,
            releaseDate: null,
            posterPath: null,
            isAnime: false,
          },
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(db.update).not.toHaveBeenCalled();
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(publishScopedWatchUpdates).toHaveBeenCalledWith(
      ["user-1"],
      "home_watchlist_sync"
    );
  });

  it("電影同步會正規化 isAnime 並收斂重複 rows", async () => {
    const db = createDbMock([
      [
        { id: "movie-wrong", isAnime: 1 },
        { id: "movie-normal", isAnime: 0 },
      ],
    ]);
    getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/home/watchlist-sync", {
        method: "POST",
        body: JSON.stringify({
          item: {
            type: "movie",
            id: 42,
            title: "Movie",
            year: null,
            releaseDate: null,
            posterPath: null,
            isAnime: true,
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(publishScopedWatchUpdates).toHaveBeenCalledWith(
      ["user-1"],
      "home_watchlist_sync",
    );
  });

  it("非法 item.id 會直接回 BAD_REQUEST", async () => {
    getDb.mockReturnValue(createDbMock([]));

    const response = await POST(
      new Request("http://localhost/api/home/watchlist-sync", {
        method: "POST",
        body: JSON.stringify({
          item: {
            type: "tv",
            id: -7,
            title: "Show",
            year: null,
            releaseDate: null,
            posterPath: null,
            isAnime: false,
          },
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "BAD_REQUEST",
      message: "Invalid payload",
    });
  });
});
