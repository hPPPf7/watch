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

import { POST } from "@/app/api/detail/watchlist-upsert/route";

function createDbMock(selectResults: unknown[]) {
  let selectIndex = 0;
  const returning = vi.fn(() => Promise.resolve([{ id: "watchlist-1" }]));
  const db = {
    execute: vi.fn(() => Promise.resolve()),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(selectResults[selectIndex++] ?? [])),
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
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  };
  return db;
}

describe("POST /api/detail/watchlist-upsert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
    runInTransaction.mockImplementation(async (callback) =>
      callback(getDb.mock.results.at(-1)?.value ?? getDb()),
    );
  });

  it("既有 TV row 分類錯誤時會重分類並收斂重複資料", async () => {
    const db = createDbMock([
      [
        { id: "tv-normal", isAnime: 0 },
        { id: "tv-anime", isAnime: 1 },
      ],
    ]);
    getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/detail/watchlist-upsert", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "tv",
          tmdbId: 42,
          isAnime: true,
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      duplicate: true,
      affectedIsAnime: [false, true],
    });
    expect(db.update).not.toHaveBeenCalled();
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(publishScopedWatchUpdates).toHaveBeenCalledWith(
      ["user-1"],
      "watchlist_upsert"
    );
  });

  it("新增成功後即使 publish 失敗也仍回 200", async () => {
    const db = createDbMock([[]]);
    getDb.mockReturnValue(db);
    publishScopedWatchUpdates.mockRejectedValueOnce(new Error("publish failed"));

    const response = await POST(
      new Request("http://localhost/api/detail/watchlist-upsert", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "movie",
          tmdbId: 42,
          isAnime: false,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      duplicate: false,
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
      new Request("http://localhost/api/detail/watchlist-upsert", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "movie",
          tmdbId: 88,
          isAnime: false,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      duplicate: false,
      affectedIsAnime: [false],
    });
    expect(publishScopedWatchUpdates).not.toHaveBeenCalled();
  });
});
