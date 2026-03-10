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
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(selectResults[selectIndex++] ?? [])),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve()),
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
    expect(db.delete).toHaveBeenCalledTimes(1);
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
});
