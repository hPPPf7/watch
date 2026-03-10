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

import { POST } from "@/app/api/detail/history-upsert/route";

function createWhereResult(result: unknown) {
  return {
    limit: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result)),
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
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([])),
        })),
        returning: vi.fn(() => Promise.resolve([])),
      })),
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
  });

  it("好友當天同作品已有紀錄時整筆不成立", async () => {
    getDb.mockReturnValue(
      createDbMock([
        [],
        [{ friendId: "friend-1" }],
        [{ userId: "friend-1" }],
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
          friendIds: ["friend-1"],
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      code: "FRIEND_HISTORY_EXISTS",
      message: "friend_history_exists",
      conflictFriendIds: ["friend-1"],
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
});
