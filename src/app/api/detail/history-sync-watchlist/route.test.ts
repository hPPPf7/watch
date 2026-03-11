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
  });

  it("朋友既有 TV row 分區錯誤時會重分類並收斂重複資料", async () => {
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
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(publishScopedWatchUpdates).toHaveBeenCalledWith(
      [
        {
          userId: FRIEND_ID,
          revisionScopes: [
            { mediaType: "tv", isAnime: false },
            { mediaType: "tv", isAnime: true },
          ],
        },
      ],
      "history_sync_watchlist"
    );
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
