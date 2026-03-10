import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, getDb, publishScopedWatchUpdates, resolveWatchlistScopedTargets } =
  vi.hoisted(() => ({
    auth: vi.fn(),
    getDb: vi.fn(),
    publishScopedWatchUpdates: vi.fn(),
    resolveWatchlistScopedTargets: vi.fn(),
  }));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("@/server/db/client", () => ({
  getDb,
}));

vi.mock("@/server/realtime/watchUpdates", () => ({
  publishScopedWatchUpdates,
  resolveWatchlistScopedTargets,
}));

import { POST } from "@/app/api/detail/history-sync-shares/route";

const FRIEND_ID = "11111111-1111-4111-8111-111111111111";

function createWhereResult(result: unknown) {
  return {
    limit: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result)),
  };
}

function createDbMock(selectResults: unknown[]) {
  let selectIndex = 0;
  const onConflictDoNothing = vi.fn();
  const insertValues = vi.fn(() => ({
    onConflictDoNothing,
  }));
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => createWhereResult(selectResults[selectIndex++])),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => createWhereResult(selectResults[selectIndex++])),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(),
    })),
    insert: vi.fn(() => ({
      values: insertValues,
    })),
  };
  return {
    ...db,
    insertValues,
    onConflictDoNothing,
    transaction: vi.fn(async (callback: (tx: typeof db) => Promise<unknown>) =>
      callback(db)
    ),
  };
}

describe("POST /api/detail/history-sync-shares", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "owner" } });
    resolveWatchlistScopedTargets.mockResolvedValue([
      {
        userId: FRIEND_ID,
        revisionScopes: [{ mediaType: "movie", isAnime: false }],
      },
    ]);
  });

  it("分享名單未變時仍會通知既有 recipients 刷新", async () => {
    getDb.mockReturnValue(
      createDbMock([
        [{ id: "history-1" }],
        [{ targetUserId: FRIEND_ID }],
        [{ friendId: FRIEND_ID }],
      ])
    );

    const response = await POST(
      new Request("http://localhost/api/detail/history-sync-shares", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "movie",
          tmdbId: 10,
          watchedAt: "2026-03-08",
          friendIds: [FRIEND_ID],
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(resolveWatchlistScopedTargets).toHaveBeenCalledWith({
      userIds: [FRIEND_ID],
      mediaType: "movie",
      tmdbId: 10,
    });
    expect(publishScopedWatchUpdates).toHaveBeenCalledWith(
      [
        {
          userId: FRIEND_ID,
          revisionScopes: [{ mediaType: "movie", isAnime: false }],
        },
      ],
      "history_sync_shares"
    );
  });

  it("會先去除重複 friendIds，避免重複 share row", async () => {
    const db = createDbMock([
      [{ id: "history-1" }],
      [],
      [{ friendId: FRIEND_ID }],
      [],
      [],
    ]);
    getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/detail/history-sync-shares", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "movie",
          tmdbId: 10,
          watchedAt: "2026-03-08",
          friendIds: [FRIEND_ID, FRIEND_ID],
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(db.insertValues).toHaveBeenCalledWith([
      {
        projectId: "watch",
        ownerId: "owner",
        targetUserId: FRIEND_ID,
        watchHistoryId: "history-1",
      },
    ]);
  });

  it("非法日期會直接回 BAD_REQUEST", async () => {
    getDb.mockReturnValue(createDbMock([]));

    const response = await POST(
      new Request("http://localhost/api/detail/history-sync-shares", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "movie",
          tmdbId: 10,
          watchedAt: "2026-02-31",
          friendIds: [FRIEND_ID],
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "BAD_REQUEST",
      message: "Invalid payload",
    });
  });

  it("非法 UUID friendIds 會直接回 BAD_REQUEST", async () => {
    getDb.mockReturnValue(createDbMock([]));

    const response = await POST(
      new Request("http://localhost/api/detail/history-sync-shares", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "movie",
          tmdbId: 10,
          watchedAt: "2026-03-08",
          friendIds: ["friend-1"],
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
      [{ id: "history-1" }],
      [],
      [{ friendId: FRIEND_ID }],
      [],
      [],
    ]);
    getDb.mockReturnValue(db);
    resolveWatchlistScopedTargets.mockRejectedValueOnce(new Error("publish failed"));

    const response = await POST(
      new Request("http://localhost/api/detail/history-sync-shares", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "movie",
          tmdbId: 10,
          watchedAt: "2026-03-08",
          friendIds: [FRIEND_ID],
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
