import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getDb,
  isRedisRealtimeEnabled,
  readLatestWatchUpdate,
  readRedisJson,
  writeRedisJson,
} = vi.hoisted(() => ({
  getDb: vi.fn(),
  isRedisRealtimeEnabled: vi.fn(),
  readLatestWatchUpdate: vi.fn(),
  readRedisJson: vi.fn(),
  writeRedisJson: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getDb,
}));

vi.mock("@/server/realtime/watchUpdates", () => ({
  readLatestWatchUpdate,
}));

vi.mock("@/server/realtime/redis", () => ({
  isRedisRealtimeEnabled,
  readRedisJson,
  writeRedisJson,
}));

import {
  getWatchlistRevision,
  STATE_REVISION_TTL_MS,
  stateRevisionCacheKey,
} from "@/server/services/watchlistRevisionService";

function createDbMock(stateRevision: string) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => Promise.resolve()),
      })),
    })),
    execute: vi.fn().mockResolvedValue({
      rows: [{ state_revision: stateRevision }],
    }),
  };
}

describe("getWatchlistRevision（Redis 路徑）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRedisRealtimeEnabled.mockReturnValue(true);
    readLatestWatchUpdate.mockResolvedValue(null);
    writeRedisJson.mockResolvedValue(true);
  });

  it("Redis 快取新於最新變更事件時直接回傳，不重算", async () => {
    const db = createDbMock("should-not-run");
    getDb.mockReturnValue(db);
    readLatestWatchUpdate.mockResolvedValue({
      reason: "history_upsert",
      at: 100,
      nonce: "n",
    });
    readRedisJson.mockResolvedValue({ stateRevision: "cached-sig", at: 200 });

    const revision = await getWatchlistRevision("user-1", "tv", true);

    expect(revision).toBe("cached-sig");
    expect(readRedisJson).toHaveBeenCalledWith(
      stateRevisionCacheKey("user-1", "tv", true),
    );
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("Redis 快取舊於最新變更事件時重算，並把新簽章寫回 Redis", async () => {
    const db = createDbMock("fresh-sig");
    getDb.mockReturnValue(db);
    readLatestWatchUpdate.mockResolvedValue({
      reason: "watchlist_upsert",
      at: 300,
      nonce: "n",
    });
    readRedisJson.mockResolvedValue({ stateRevision: "stale-sig", at: 100 });

    const revision = await getWatchlistRevision("user-1", "movie", false);

    expect(revision).toBe("fresh-sig");
    expect(writeRedisJson).toHaveBeenCalledWith(
      stateRevisionCacheKey("user-1", "movie", false),
      expect.objectContaining({ stateRevision: "fresh-sig" }),
      STATE_REVISION_TTL_MS,
    );
    // Redis 模式下不應把簽章快取寫進 Neon 的 tmdbCache 表。
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("Redis 讀取失敗（回 null）時視為 cache miss，重算後仍可回傳簽章", async () => {
    const db = createDbMock("computed-sig");
    getDb.mockReturnValue(db);
    readRedisJson.mockResolvedValue(null);

    const revision = await getWatchlistRevision("user-1", "movie", false);

    expect(revision).toBe("computed-sig");
  });

  it("在計算簽章前記錄快照時間，讓計算期間的 mutation 能使快取失效", async () => {
    const events: string[] = [];
    const db = createDbMock("computed-before-mutation");
    db.execute.mockImplementation(async () => {
      events.push("compute");
      return { rows: [{ state_revision: "computed-before-mutation" }] };
    });
    getDb.mockReturnValue(db);
    readRedisJson.mockResolvedValue(null);
    vi.spyOn(Date, "now").mockImplementation(() => {
      events.push("snapshot");
      return 100;
    });

    await getWatchlistRevision("user-1", "tv", false);

    expect(events).toEqual(["snapshot", "compute"]);
    expect(writeRedisJson).toHaveBeenCalledWith(
      stateRevisionCacheKey("user-1", "tv", false),
      { stateRevision: "computed-before-mutation", at: 100 },
      STATE_REVISION_TTL_MS,
    );
  });
});
