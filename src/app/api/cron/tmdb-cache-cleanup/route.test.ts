import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDb, publishScopedWatchUpdates, writeTmdbCache } = vi.hoisted(() => ({
  getDb: vi.fn(),
  publishScopedWatchUpdates: vi.fn(),
  writeTmdbCache: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({ getDb }));
vi.mock("@/server/realtime/watchUpdates", () => ({
  publishScopedWatchUpdates,
}));
vi.mock("@/server/tmdb/cache", () => ({
  writeTmdbCache,
}));

import { GET } from "@/app/api/cron/tmdb-cache-cleanup/route";

function createDbMock() {
  const cacheReturning = vi.fn(() => Promise.resolve([{ key: "expired" }]));
  const cacheWhere = vi.fn(() => ({ returning: cacheReturning }));
  const stateReturning = vi.fn(() =>
    Promise.resolve([
      { id: "state-1", userId: "user-1" },
      { id: "state-2", userId: "user-2" },
      { id: "state-3", userId: "user-1" },
    ]),
  );
  const stateWhere = vi.fn(() => ({ returning: stateReturning }));
  const stateSet = vi.fn(() => ({ where: stateWhere }));

  return {
    delete: vi.fn(() => ({ where: cacheWhere })),
    update: vi.fn(() => ({ set: stateSet })),
    stateSet,
  };
}

describe("GET /api/cron/tmdb-cache-cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret";
  });

  it("清除過期 TMDB cache 並重設超過 180 天的 TV 衍生 state", async () => {
    const db = createDbMock();
    getDb.mockReturnValue(db);

    const response = await GET(
      new Request("http://localhost/api/cron/tmdb-cache-cleanup", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        deleted: 1,
        staleTvStatesCleaned: 3,
      }),
    );
    expect(db.stateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        lastTotalAired: null,
        alertActive: false,
        alertGeneration: null,
        alertAcknowledgedGeneration: null,
        nextEpisodeName: null,
        nextEpisodeAirDate: null,
        tmdbMetadataFetchedAt: null,
        checkedAt: null,
      }),
    );
    // 清理動了 revision 簽章涵蓋的欄位，必須對受影響使用者（去重後）
    // 發 watch update，否則要等 revision 快取 TTL 過期才會被看到。
    expect(publishScopedWatchUpdates).toHaveBeenCalledWith(
      ["user-1", "user-2"],
      "tv_state_metadata_cleanup",
    );
    // 執行摘要寫回共用 Neon，供本機 npm run cron:status 查詢。
    expect(writeTmdbCache).toHaveBeenCalledWith(
      "watch:cron:tmdb-cache-cleanup:last-run",
      expect.objectContaining({
        ok: true,
        deleted: 1,
        staleTvStatesCleaned: 3,
        affectedUsers: 2,
      }),
      expect.any(Number),
    );
  });

  it("拒絕沒有正確 cron secret 的請求", async () => {
    getDb.mockReturnValue(createDbMock());

    const response = await GET(
      new Request("http://localhost/api/cron/tmdb-cache-cleanup"),
    );

    expect(response.status).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
  });
});
