import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, getDb, publishScopedWatchUpdates } = vi.hoisted(() => ({
  auth: vi.fn(),
  getDb: vi.fn(),
  publishScopedWatchUpdates: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("@/server/db/client", () => ({
  getDb,
}));

vi.mock("@/server/realtime/watchUpdates", () => ({
  publishScopedWatchUpdates,
}));

import { POST } from "@/app/api/home/watchlist-toggle/route";

function createDbMock(selectResults: unknown[]) {
  let selectIndex = 0;
  const returning = vi.fn(() => Promise.resolve([{ id: "watchlist-1" }]));
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(selectResults[selectIndex++])),
        limit: vi.fn(() => Promise.resolve(selectResults[selectIndex++])),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning,
        })),
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
  return db;
}

describe("POST /api/home/watchlist-toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("TV 重分類時會清掉重複 row，只保留目標分區", async () => {
    const db = createDbMock([
      [
        { id: "tv-normal", isAnime: 0 },
        { id: "tv-anime", isAnime: 1 },
      ],
    ]);
    getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/home/watchlist-toggle", {
        method: "POST",
        body: JSON.stringify({
          action: "add",
          item: {
            type: "tv",
            id: 42,
            title: "Show",
            year: null,
            releaseDate: null,
            posterPath: null,
            isAnime: true,
          },
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(publishScopedWatchUpdates).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          userId: "user-1",
          revisionScopes: expect.arrayContaining([
            { mediaType: "tv", isAnime: false },
            { mediaType: "tv", isAnime: true },
          ]),
        }),
      ],
      "home_watchlist_reclassify"
    );
  });

  it("新增成功後即使 publish 失敗也仍回 200", async () => {
    const db = createDbMock([[]]);
    getDb.mockReturnValue(db);
    publishScopedWatchUpdates.mockRejectedValueOnce(new Error("publish failed"));

    const response = await POST(
      new Request("http://localhost/api/home/watchlist-toggle", {
        method: "POST",
        body: JSON.stringify({
          action: "add",
          item: {
            type: "movie",
            id: 7,
            title: "Movie",
            year: null,
            releaseDate: null,
            posterPath: null,
            isAnime: false,
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("insert 因 onConflictDoNothing 成為 no-op 時不發送刷新", async () => {
    const db = createDbMock([[]]);
    getDb.mockReturnValue(db);
    db.insert.mockImplementationOnce(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([])),
        })),
      })),
    }));

    const response = await POST(
      new Request("http://localhost/api/home/watchlist-toggle", {
        method: "POST",
        body: JSON.stringify({
          action: "add",
          item: {
            type: "movie",
            id: 9,
            title: "Movie",
            year: null,
            releaseDate: null,
            posterPath: null,
            isAnime: false,
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(publishScopedWatchUpdates).not.toHaveBeenCalled();
  });
});
