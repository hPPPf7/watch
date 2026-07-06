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

import { POST } from "@/app/api/detail/history-sync-watchlist/route";

const FRIEND_ID = "11111111-1111-4111-8111-111111111111";

function createDbMock(selectResults: unknown[]) {
  let selectIndex = 0;
  const insertReturning = vi.fn<() => Promise<Array<{ id: string }>>>(() =>
    Promise.resolve([])
  );
  const onConflictDoNothing = vi.fn(() => ({
    returning: insertReturning,
  }));
  const insertValues = vi.fn(() => ({
    onConflictDoNothing,
  }));
  return {
    execute: vi.fn(() => Promise.resolve()),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(selectResults[selectIndex++] ?? [])),
      })),
    })),
    insert: vi.fn(() => ({
      values: insertValues,
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
    insertValues,
    insertReturning,
    onConflictDoNothing,
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve(selectResults[selectIndex++] ?? [])),
          })),
        })),
        insert: vi.fn(() => ({
          values: insertValues,
        })),
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve()),
          })),
        })),
        delete: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      })
    ),
  };
}

describe("POST /api/detail/history-sync-watchlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
    runInTransaction.mockImplementation(async (callback) =>
      callback(getDb.mock.results.at(-1)?.value ?? getDb())
    );
  });

  it("朋友清單已有這部作品時，同步不會改動朋友既有的分類（即使跟自己認定的不同）", async () => {
    // 動畫/影集分類理論上是 TMDB 資料決定的固定值，不該因人而異；同步觀看紀錄
    // 這個動作不該有權限改寫朋友清單裡已存在項目的分類，即使朋友那邊剛好有
    // 分類不一致（甚至重複）的舊資料，也應該原封不動，留給朋友自己處理。
    const db = createDbMock([
      [{ friendId: FRIEND_ID }],
      [
        { id: "tv-normal", isAnime: 0 },
        { id: "tv-anime", isAnime: 1 },
      ],
    ]);
    getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/detail/history-sync-watchlist", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "tv",
          tmdbId: 42,
          isAnime: true,
          friendIds: [FRIEND_ID],
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(db.update).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(runInTransaction).toHaveBeenCalledTimes(1);
    expect(publishScopedWatchUpdates).not.toHaveBeenCalled();
  });

  it("非法 tmdbId 會直接回 BAD_REQUEST", async () => {
    getDb.mockReturnValue(createDbMock([]));

    const response = await POST(
      new Request("http://localhost/api/detail/history-sync-watchlist", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "tv",
          tmdbId: -42,
          isAnime: true,
          friendIds: [FRIEND_ID],
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "BAD_REQUEST",
      message: "Invalid payload",
    });
  });

  it("資料已寫入後即使 publish 失敗也仍回 200", async () => {
    const db = createDbMock([
      [{ friendId: FRIEND_ID }],
      [],
    ]);
    db.insertReturning.mockResolvedValueOnce([{ id: "watchlist-1" }]);
    getDb.mockReturnValue(db);
    publishScopedWatchUpdates.mockRejectedValueOnce(new Error("publish failed"));

    const response = await POST(
      new Request("http://localhost/api/detail/history-sync-watchlist", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "movie",
          tmdbId: 42,
          friendIds: [FRIEND_ID],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
