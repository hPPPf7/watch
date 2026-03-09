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

import { POST } from "@/app/api/detail/watchlist-delete/route";

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
  };
}

describe("POST /api/detail/watchlist-delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("只要有共享觀看紀錄就不能移除清單", async () => {
    getDb.mockReturnValue(
      createDbMock([
        [],
        [{ id: "shared-history" }],
      ])
    );

    const response = await POST(
      new Request("http://localhost/api/detail/watchlist-delete", {
        method: "POST",
        body: JSON.stringify({ mediaType: "movie", tmdbId: 99 }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      code: "WATCH_HISTORY_EXISTS",
      message: "watch_history_exists",
    });
    expect(publishScopedWatchUpdates).not.toHaveBeenCalled();
  });

  it("刪除前會保留原本分區 scope 來通知刷新", async () => {
    const db = createDbMock([
      [],
      [],
      [
        { id: "tv-normal", isAnime: 0 },
        { id: "tv-anime", isAnime: 1 },
      ],
    ]);
    getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/detail/watchlist-delete", {
        method: "POST",
        body: JSON.stringify({ mediaType: "tv", tmdbId: 77, isAnime: true }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(publishScopedWatchUpdates).toHaveBeenCalledWith(
      [
        {
          userId: "user-1",
          revisionScopes: [
            { mediaType: "tv", isAnime: false },
            { mediaType: "tv", isAnime: true },
          ],
        },
      ],
      "watchlist_delete"
    );
  });
});
