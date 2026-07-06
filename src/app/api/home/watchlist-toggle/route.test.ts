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

import { POST } from "@/app/api/home/watchlist-toggle/route";

function createDbMock(selectResults: unknown[]) {
  let selectIndex = 0;
  const returning = vi.fn(() => Promise.resolve([{ id: "watchlist-1" }]));
  const createWhereChain = () => {
    const result = selectResults[selectIndex++] ?? [];
    return {
      limit: vi.fn(() => Promise.resolve(result)),
      then: Promise.resolve(result).then.bind(Promise.resolve(result)),
    };
  };
  const db = {
    execute: vi.fn(() => Promise.resolve()),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => createWhereChain()),
        limit: vi.fn(() => Promise.resolve(selectResults[selectIndex++])),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => createWhereChain()),
          limit: vi.fn(() => Promise.resolve(selectResults[selectIndex++])),
        })),
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
    runInTransaction.mockImplementation(async (callback) =>
      callback(getDb.mock.results.at(-1)?.value ?? getDb()),
    );
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
    expect(payload).toEqual({ ok: true, affectedIsAnime: [false, true] });
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(publishScopedWatchUpdates).toHaveBeenCalledWith(
      ["user-1"],
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
    expect(await response.json()).toEqual({
      ok: true,
      affectedIsAnime: [false],
    });
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
    expect(await response.json()).toEqual({
      ok: true,
      affectedIsAnime: [false],
    });
    expect(publishScopedWatchUpdates).not.toHaveBeenCalled();
  });

  it("TV 移除時只刪除目前分區，不會連另一個 bucket 一起刪", async () => {
    const db = createDbMock([
      [{ id: "tv-anime", isAnime: 1 }],
      [],
      [],
    ]);
    getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/home/watchlist-toggle", {
        method: "POST",
        body: JSON.stringify({
          action: "remove",
          item: {
            type: "tv",
            id: 42,
            title: "Anime",
            year: null,
            releaseDate: null,
            posterPath: null,
            isAnime: true,
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      affectedIsAnime: [true],
    });
    expect(db.delete).toHaveBeenCalledTimes(2);
    expect(publishScopedWatchUpdates).toHaveBeenCalledWith(
      ["user-1"],
      "home_watchlist_remove"
    );
  });

  it("TV 另一個分區仍存在時會保留提醒 state", async () => {
    const db = createDbMock([
      [
        { id: "tv-normal", isAnime: 0 },
        { id: "tv-anime", isAnime: 1 },
      ],
      [],
      [],
      [{ id: "tv-normal" }],
    ]);
    getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/home/watchlist-toggle", {
        method: "POST",
        body: JSON.stringify({
          action: "remove",
          item: {
            type: "tv",
            id: 42,
            title: "Anime",
            year: null,
            releaseDate: null,
            posterPath: null,
            isAnime: true,
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it("TV 移除時若只剩相反 bucket 的舊資料，仍會清掉那唯一一筆", async () => {
    const db = createDbMock([
      [{ id: "tv-normal", isAnime: 0 }],
      [],
      [],
    ]);
    getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/home/watchlist-toggle", {
        method: "POST",
        body: JSON.stringify({
          action: "remove",
          item: {
            type: "tv",
            id: 42,
            title: "Anime",
            year: null,
            releaseDate: null,
            posterPath: null,
            isAnime: true,
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      affectedIsAnime: [false],
    });
    expect(db.delete).toHaveBeenCalledTimes(2);
    expect(publishScopedWatchUpdates).toHaveBeenCalledWith(
      ["user-1"],
      "home_watchlist_remove"
    );
  });

  it("未知 action 會直接回 BAD_REQUEST", async () => {
    const db = createDbMock([]);
    getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/home/watchlist-toggle", {
        method: "POST",
        body: JSON.stringify({
          action: "noop",
          item: {
            type: "movie",
            id: 1,
            title: "Movie",
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

  it("非法 item.id 會直接回 BAD_REQUEST", async () => {
    const db = createDbMock([]);
    getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/home/watchlist-toggle", {
        method: "POST",
        body: JSON.stringify({
          action: "add",
          item: {
            type: "movie",
            id: -1,
            title: "Movie",
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
