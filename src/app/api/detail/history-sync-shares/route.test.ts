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

function createWhereResult(result: unknown) {
  return {
    limit: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result)),
  };
}

function createDbMock(selectResults: unknown[]) {
  let selectIndex = 0;
  return {
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
      values: vi.fn(),
    })),
  };
}

describe("POST /api/detail/history-sync-shares", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "owner" } });
    resolveWatchlistScopedTargets.mockResolvedValue([
      {
        userId: "friend-1",
        revisionScopes: [{ mediaType: "movie", isAnime: false }],
      },
    ]);
  });

  it("分享名單未變時仍會通知既有 recipients 刷新", async () => {
    getDb.mockReturnValue(
      createDbMock([
        [{ id: "history-1" }],
        [{ targetUserId: "friend-1" }],
        [{ friendId: "friend-1" }],
      ])
    );

    const response = await POST(
      new Request("http://localhost/api/detail/history-sync-shares", {
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

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(resolveWatchlistScopedTargets).toHaveBeenCalledWith({
      userIds: ["friend-1"],
      mediaType: "movie",
      tmdbId: 10,
    });
    expect(publishScopedWatchUpdates).toHaveBeenCalledWith(
      [
        {
          userId: "friend-1",
          revisionScopes: [{ mediaType: "movie", isAnime: false }],
        },
      ],
      "history_sync_shares"
    );
  });
});
