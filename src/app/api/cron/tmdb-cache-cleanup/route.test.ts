import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDb } = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({ getDb }));

import { GET } from "@/app/api/cron/tmdb-cache-cleanup/route";

function createDbMock() {
  const cacheReturning = vi.fn(() => Promise.resolve([{ key: "expired" }]));
  const cacheWhere = vi.fn(() => ({ returning: cacheReturning }));
  const stateReturning = vi.fn(() =>
    Promise.resolve([{ id: "state-1" }, { id: "state-2" }]),
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
        staleTvStatesCleaned: 2,
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
