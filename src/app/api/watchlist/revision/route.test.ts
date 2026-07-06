import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, getDb, readLatestWatchUpdate } = vi.hoisted(() => ({
  auth: vi.fn(),
  getDb: vi.fn(),
  readLatestWatchUpdate: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("@/server/db/client", () => ({
  getDb,
}));

vi.mock("@/server/realtime/watchUpdates", () => ({
  readLatestWatchUpdate,
}));

import { GET } from "@/app/api/watchlist/revision/route";

function createDbMock(options: {
  cachedStateRows?: unknown[];
  executeResult?: unknown;
  executeError?: Error;
}) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(options.cachedStateRows ?? [])),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => Promise.resolve()),
      })),
    })),
    execute: options.executeError
      ? vi.fn().mockRejectedValue(options.executeError)
      : vi.fn().mockResolvedValue(options.executeResult),
  };
}

describe("GET /api/watchlist/revision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
    readLatestWatchUpdate.mockResolvedValue(null);
  });

  it("沒有可用的 state cache 時，現算 state revision 並直接回傳（不混用其他格式）", async () => {
    getDb.mockReturnValue(
      createDbMock({
        cachedStateRows: [],
        executeResult: {
          rows: [{ state_revision: "state-sig" }],
        },
      }),
    );

    const response = await GET(
      new Request("http://localhost/api/watchlist/revision?mediaType=movie")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ revision: "state-sig" });
  });

  it("state cache 夠新時直接回傳快取的 state revision，不重算", async () => {
    const db = createDbMock({
      cachedStateRows: [
        {
          payload: { stateRevision: "cached-sig", at: 300 },
          expiresAt: new Date(Date.now() + 10_000).toISOString(),
        },
      ],
      executeResult: {
        rows: [{ state_revision: "should-not-run" }],
      },
    });
    getDb.mockReturnValue(db);
    readLatestWatchUpdate.mockResolvedValue({
      reason: "history_upsert",
      at: 200,
      nonce: "nonce",
    });

    const response = await GET(
      new Request("http://localhost/api/watchlist/revision?mediaType=tv&isAnime=true"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ revision: "cached-sig" });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("只把 getDb 初始化失敗視為 CONFIG_MISSING", async () => {
    getDb.mockImplementation(() => {
      throw new Error("DATABASE_URL_MISSING");
    });

    const response = await GET(
      new Request("http://localhost/api/watchlist/revision?mediaType=movie")
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      code: "CONFIG_MISSING",
      message: "DATABASE_URL is required",
    });
  });

  it("查詢失敗時回 REVISION_FAILED，而不是誤報成設定問題", async () => {
    getDb.mockReturnValue(
      createDbMock({
        cachedStateRows: [],
        executeError: new Error("query failed"),
      }),
    );

    const response = await GET(
      new Request("http://localhost/api/watchlist/revision?mediaType=tv&isAnime=true")
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      code: "REVISION_FAILED",
      message: "Failed to load revision",
    });
  });

  it("有較新的 watch:updates 事件時，不沿用舊 state cache，改用新算出的簽章", async () => {
    getDb.mockReturnValue(
      createDbMock({
        cachedStateRows: [
          {
            payload: { stateRevision: "stale-sig", at: 100 },
            expiresAt: new Date(Date.now() + 10_000).toISOString(),
          },
        ],
        executeResult: {
          rows: [{ state_revision: "fresh-sig" }],
        },
      }),
    );
    readLatestWatchUpdate.mockResolvedValue({
      reason: "friend_remove_history_share",
      at: 200,
      nonce: "nonce",
    });

    const response = await GET(
      new Request("http://localhost/api/watchlist/revision?mediaType=movie"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ revision: "fresh-sig" });
  });

  it("不同 scope（例如 tv 的其他分類）發生變更時，不影響本 scope 已快取的 state revision", async () => {
    // 這是 #3 修復要保護的情境：即使使用者其他 scope 剛好有變更事件
    // （latestWatchUpdate 被推進），只要本 scope 的 state cache 仍新於該事件，
    // 就必須沿用同一份簽章，不能因為切換到別的計算路徑而產生不同格式的值。
    const db = createDbMock({
      cachedStateRows: [
        {
          payload: { stateRevision: "movie-sig", at: 500 },
          expiresAt: new Date(Date.now() + 10_000).toISOString(),
        },
      ],
      executeResult: {
        rows: [{ state_revision: "should-not-run" }],
      },
    });
    getDb.mockReturnValue(db);
    readLatestWatchUpdate.mockResolvedValue({
      reason: "watchlist_upsert",
      at: 400,
      nonce: "nonce",
    });

    const first = await GET(
      new Request("http://localhost/api/watchlist/revision?mediaType=movie"),
    );
    const firstPayload = await first.json();

    readLatestWatchUpdate.mockResolvedValue({
      reason: "watchlist_upsert",
      at: 450,
      nonce: "nonce-2",
    });

    const second = await GET(
      new Request("http://localhost/api/watchlist/revision?mediaType=movie"),
    );
    const secondPayload = await second.json();

    expect(firstPayload).toEqual({ revision: "movie-sig" });
    expect(secondPayload).toEqual({ revision: "movie-sig" });
    expect(db.execute).not.toHaveBeenCalled();
  });
});
