import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, getDb, readLatestWatchUpdate, readWatchlistRevision } = vi.hoisted(() => ({
  auth: vi.fn(),
  getDb: vi.fn(),
  readLatestWatchUpdate: vi.fn(),
  readWatchlistRevision: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("@/server/db/client", () => ({
  getDb,
}));

vi.mock("@/server/realtime/watchUpdates", () => ({
  readLatestWatchUpdate,
  readWatchlistRevision,
  watchlistRevisionKey: (
    userId: string,
    mediaType: "movie" | "tv",
    isAnime: boolean,
  ) => `watch:revision:${userId}:${mediaType}:${isAnime ? 1 : 0}`,
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

  it("在 scoped revision key 過期時，沿用 stateRevision 保持 revision 穩定", async () => {
    getDb.mockReturnValue(
      createDbMock({
        cachedStateRows: [],
        executeResult: {
          rows: [{ state_revision: "state-sig" }],
        },
      }),
    );
    readWatchlistRevision.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/watchlist/revision?mediaType=movie")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ revision: "state-sig:state-sig" });
  });

  it("有足夠新的 scoped revision 時不重算 state revision", async () => {
    const db = createDbMock({
      cachedStateRows: [
        {
          payload: { revision: "scoped-revision", at: 300 },
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
    readWatchlistRevision.mockResolvedValue("should-not-read");

    const response = await GET(
      new Request("http://localhost/api/watchlist/revision?mediaType=tv&isAnime=true"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ revision: "scoped-revision:scoped-revision" });
    expect(db.execute).not.toHaveBeenCalled();
    expect(readWatchlistRevision).not.toHaveBeenCalled();
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
    readWatchlistRevision.mockResolvedValue("cached");

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

  it("有較新的 watch:updates 事件時，不沿用舊 state cache", async () => {
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
    readWatchlistRevision.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/watchlist/revision?mediaType=movie"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ revision: "fresh-sig:fresh-sig" });
  });
});
