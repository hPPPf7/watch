import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, getDb, resolveWatchlistScopedTargets, publishScopedWatchUpdates } =
  vi.hoisted(() => ({
    auth: vi.fn(),
    getDb: vi.fn(),
    resolveWatchlistScopedTargets: vi.fn(),
    publishScopedWatchUpdates: vi.fn(),
  }));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("@/server/db/client", () => ({
  getDb,
}));

vi.mock("@/server/realtime/watchUpdates", () => ({
  resolveWatchlistScopedTargets,
  publishScopedWatchUpdates,
}));

import { POST } from "@/app/api/detail/history-delete/route";

function createDbMock(selectResults: unknown[]) {
  let selectIndex = 0;
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(selectResults[selectIndex++] ?? [])),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  };
  return {
    ...db,
    transaction: vi.fn(async (callback: (tx: typeof db) => Promise<unknown>) =>
      callback(db)
    ),
  };
}

describe("POST /api/detail/history-delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
    resolveWatchlistScopedTargets.mockResolvedValue(["scoped-target"]);
  });

  it("刪除紀錄時會先清 shares 並通知 share recipients", async () => {
    const db = createDbMock([
      [{ id: "history-1" }],
      [{ targetUserId: "friend-1" }],
    ]);
    getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/detail/history-delete", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "movie",
          tmdbId: 99,
          season: 0,
          episode: 0,
          watchedAt: "2026-03-09",
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(db.delete).toHaveBeenCalledTimes(2);
    expect(resolveWatchlistScopedTargets).toHaveBeenCalledWith({
      userIds: ["user-1", "friend-1"],
      mediaType: "movie",
      tmdbId: 99,
    });
    expect(publishScopedWatchUpdates).toHaveBeenCalledWith(
      ["scoped-target"],
      "history_delete"
    );
  });

  it("非法日期會直接回 BAD_REQUEST", async () => {
    getDb.mockReturnValue(createDbMock([]));

    const response = await POST(
      new Request("http://localhost/api/detail/history-delete", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "movie",
          tmdbId: 99,
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
      new Request("http://localhost/api/detail/history-delete", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "tv",
          tmdbId: 0,
          season: -1,
          episode: 1.5,
          watchedAt: "2026-03-09",
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "BAD_REQUEST",
      message: "Invalid payload",
    });
  });

  it("資料已刪除後即使 publish 失敗也仍回 200", async () => {
    const db = createDbMock([
      [{ id: "history-1" }],
      [{ targetUserId: "friend-1" }],
    ]);
    getDb.mockReturnValue(db);
    resolveWatchlistScopedTargets.mockRejectedValueOnce(new Error("publish failed"));

    const response = await POST(
      new Request("http://localhost/api/detail/history-delete", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "movie",
          tmdbId: 99,
          watchedAt: "2026-03-09",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("resolve scopes 失敗時仍會退回 generic userIds 發送刷新", async () => {
    const db = createDbMock([
      [{ id: "history-1" }],
      [{ targetUserId: "friend-1" }],
    ]);
    getDb.mockReturnValue(db);
    resolveWatchlistScopedTargets.mockRejectedValueOnce(new Error("resolve failed"));

    const response = await POST(
      new Request("http://localhost/api/detail/history-delete", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "movie",
          tmdbId: 99,
          watchedAt: "2026-03-09",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(publishScopedWatchUpdates).toHaveBeenCalledWith(
      ["user-1", "friend-1"],
      "history_delete"
    );
  });
});
