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

import { POST } from "@/app/api/watchlist/tv-states/upsert/route";

function createDbMock(selectResults: unknown[]) {
  let selectIndex = 0;
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(selectResults[selectIndex++] ?? [])),
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
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => Promise.resolve()),
      })),
    })),
  };
  return {
    ...db,
    transaction: vi.fn(async (callback: (tx: typeof db) => Promise<unknown>) =>
      callback(db)
    ),
  };
}

describe("POST /api/watchlist/tv-states/upsert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("只有 checkedAt 變動時不發送刷新通知", async () => {
    const db = createDbMock([
      [
        {
          id: "state-1",
          lastProgress: "watching",
          lastTotalAired: 12,
          lastWatchedCount: 3,
        },
      ],
    ]);
    getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/watchlist/tv-states/upsert", {
        method: "POST",
        body: JSON.stringify({
          states: [
            {
              tmdb_id: 99,
              last_progress: "watching",
              last_total_aired: 12,
              last_watched_count: 3,
              last_checked_at: "2026-03-09T00:00:00.000Z",
            },
          ],
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(publishScopedWatchUpdates).not.toHaveBeenCalled();
  });

  it("清理 duplicate rows 時仍視為變更並通知對應分區", async () => {
    const db = createDbMock([
      [
        {
          id: "state-1",
          lastProgress: "watching",
          lastTotalAired: 12,
          lastWatchedCount: 3,
        },
        {
          id: "state-2",
          lastProgress: "watching",
          lastTotalAired: 12,
          lastWatchedCount: 3,
        },
      ],
      [{ tmdbId: 99, isAnime: 1 }],
    ]);
    getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/watchlist/tv-states/upsert", {
        method: "POST",
        body: JSON.stringify({
          states: [
            {
              tmdb_id: 99,
              last_progress: "watching",
              last_total_aired: 12,
              last_watched_count: 3,
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(publishScopedWatchUpdates).toHaveBeenCalledWith(
      [
        {
          userId: "user-1",
          revisionScopes: [{ mediaType: "tv", isAnime: true }],
        },
      ],
      "watchlist_tv_states_upsert"
    );
  });

  it("遇到無效數值與日期 payload 時回 400", async () => {
    getDb.mockReturnValue(createDbMock([]));

    const response = await POST(
      new Request("http://localhost/api/watchlist/tv-states/upsert", {
        method: "POST",
        body: JSON.stringify({
          states: [
            {
              tmdb_id: 99,
              last_progress: "watching",
              last_total_aired: -1,
              last_watched_count: Number.NaN,
              last_checked_at: "not-a-date",
            },
          ],
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      code: "BAD_REQUEST",
      message: "Invalid payload",
    });
    expect(getDb).not.toHaveBeenCalled();
    expect(publishScopedWatchUpdates).not.toHaveBeenCalled();
  });

  it("資料已更新後即使 publish 失敗也仍回 200", async () => {
    const db = createDbMock([
      [
        {
          id: "state-1",
          lastProgress: "unwatched",
          lastTotalAired: 0,
          lastWatchedCount: 0,
        },
      ],
      [{ tmdbId: 99, isAnime: 0 }],
    ]);
    getDb.mockReturnValue(db);
    publishScopedWatchUpdates.mockRejectedValueOnce(new Error("publish failed"));

    const response = await POST(
      new Request("http://localhost/api/watchlist/tv-states/upsert", {
        method: "POST",
        body: JSON.stringify({
          states: [
            {
              tmdb_id: 99,
              last_progress: "watching",
              last_total_aired: 12,
              last_watched_count: 3,
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
