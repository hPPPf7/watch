import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  auth,
  getDb,
  runInTransaction,
  publishScopedWatchUpdates,
  resolveWatchlistScopedTargets,
} =
  vi.hoisted(() => ({
    auth: vi.fn(),
    getDb: vi.fn(),
    runInTransaction: vi.fn(),
    publishScopedWatchUpdates: vi.fn(),
    resolveWatchlistScopedTargets: vi.fn(),
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
  resolveWatchlistScopedTargets,
}));

import { POST } from "@/app/api/detail/history-upsert/route";

const FRIEND_ID = "11111111-1111-4111-8111-111111111111";

function createWhereResult(result: unknown) {
  return {
    limit: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result)),
  };
}

function createInsertResult(rows: Array<{ id: string }> = []) {
  return {
    onConflictDoNothing: vi.fn(() => ({
      returning: vi.fn(() => Promise.resolve(rows)),
    })),
    returning: vi.fn(() => Promise.resolve(rows)),
  };
}

function createDbMock(selectResults: unknown[]) {
  let selectIndex = 0;
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => createWhereResult(selectResults[selectIndex++])),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => createWhereResult(selectResults[selectIndex++])),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => createInsertResult()),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(),
    })),
  };
  return {
    ...db,
    transaction: vi.fn(async (callback: (tx: typeof db) => Promise<unknown>) =>
      callback(db)
    ),
  };
}

describe("POST /api/detail/history-upsert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "owner" } });
    runInTransaction.mockImplementation(async (callback) =>
      callback(getDb.mock.results.at(-1)?.value ?? getDb())
    );
  });

  it("好友當天同作品已有紀錄時整筆不成立", async () => {
    getDb.mockReturnValue(
      createDbMock([
        [],
        [{ friendId: FRIEND_ID }],
        [{ userId: FRIEND_ID }],
        [],
      ])
    );

    const response = await POST(
      new Request("http://localhost/api/detail/history-upsert", {
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

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      code: "FRIEND_HISTORY_EXISTS",
      message: "friend_history_exists",
      conflictFriendIds: [FRIEND_ID],
    });
    expect(publishScopedWatchUpdates).not.toHaveBeenCalled();
    expect(resolveWatchlistScopedTargets).not.toHaveBeenCalled();
  });

  it("非法日期會直接回 BAD_REQUEST", async () => {
    getDb.mockReturnValue(createDbMock([]));

    const response = await POST(
      new Request("http://localhost/api/detail/history-upsert", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "movie",
          tmdbId: 10,
          watchedAt: "2026-02-31",
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "BAD_REQUEST",
      message: "Invalid payload",
    });
  });

  it("非法 tmdbId 與 season/episode 會直接回 BAD_REQUEST", async () => {
    getDb.mockReturnValue(createDbMock([]));

    const response = await POST(
      new Request("http://localhost/api/detail/history-upsert", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "tv",
          tmdbId: -10,
          season: 1.5,
          episode: -1,
          watchedAt: "2026-03-08",
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "BAD_REQUEST",
      message: "Invalid payload",
    });
  });

  it("資料已寫入後即使 publish 失敗也仍回 200", async () => {
    const db = createDbMock([
      [],
      [],
    ]);
    getDb.mockReturnValue(db);
    resolveWatchlistScopedTargets.mockRejectedValueOnce(new Error("publish failed"));

    db.insert.mockImplementationOnce(() => ({
      values: vi.fn(() => createInsertResult([{ id: "history-1" }])),
    }));

    const response = await POST(
      new Request("http://localhost/api/detail/history-upsert", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "movie",
          tmdbId: 10,
          watchedAt: "2026-03-08",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, duplicate: false });
  });

  it("只改日期且未送 friendIds 時也會通知既有共享對象", async () => {
    const db = createDbMock([
      [{ id: "history-1" }],
      [],
      [{ targetUserId: FRIEND_ID }],
    ]);
    getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/detail/history-upsert", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "movie",
          tmdbId: 10,
          watchedAt: "2026-03-09",
          originalDate: "2026-03-08",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(resolveWatchlistScopedTargets).toHaveBeenCalledWith({
      userIds: ["owner", FRIEND_ID],
      mediaType: "movie",
      tmdbId: 10,
    });
  });
});
