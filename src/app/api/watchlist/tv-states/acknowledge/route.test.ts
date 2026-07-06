import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  auth,
  getDb,
  runInTransaction,
  publishScopedWatchUpdates,
  runBestEffortPublish,
} =
  vi.hoisted(() => ({
    auth: vi.fn(),
    getDb: vi.fn(),
    runInTransaction: vi.fn(),
    publishScopedWatchUpdates: vi.fn(),
    runBestEffortPublish: vi.fn(
      async (_label: string, callback: () => Promise<void>) => callback(),
    ),
  }));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/server/db/client", () => ({ getDb, runInTransaction }));
vi.mock("@/server/realtime/watchUpdates", () => ({
  publishScopedWatchUpdates,
}));
vi.mock("@/server/realtime/safePublish", () => ({ runBestEffortPublish }));

import { POST } from "@/app/api/watchlist/tv-states/acknowledge/route";

function createDbMock(
  rows: unknown[],
  metadataRows: Array<{ updatedAt: Date }> = [],
  returningRow: Record<string, unknown> | null = null,
) {
  const where = vi.fn(() => Promise.resolve(rows));
  const returning = vi.fn(() =>
    Promise.resolve(returningRow ? [returningRow] : []),
  );
  const onConflictDoUpdate = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  return {
    execute: vi.fn(() => Promise.resolve()),
    select: vi.fn((selection?: Record<string, unknown>) => ({
      from: vi.fn(() => ({
        where:
          selection &&
          Object.keys(selection).length === 1 &&
          "updatedAt" in selection
            ? vi.fn(() => Promise.resolve(metadataRows))
            : where,
      })),
    })),
    insert: vi.fn(() => ({ values })),
    values,
    onConflictDoUpdate,
  };
}

describe("POST /api/watchlist/tv-states/acknowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
    runInTransaction.mockImplementation(async (callback) =>
      callback(getDb.mock.results.at(-1)?.value ?? getDb()),
    );
  });

  it("集數清單成功載入後會清除提醒並將首播提醒標記為已讀", async () => {
    const db = createDbMock([
      { isAnime: 1 },
    ], [
      { updatedAt: new Date("2026-07-01T00:00:00.000Z") },
    ]);
    getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/watchlist/tv-states/acknowledge", {
        method: "POST",
        body: JSON.stringify({
          tmdbId: 99,
          alertGeneration: "first-release:2026-07-03",
          firstRelease: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, changed: true });
    expect(runInTransaction).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        alertActive: false,
        alertStartedAt: null,
        alertAcknowledgedGeneration: "first-release:2026-07-03",
        firstReleaseAlertState: "acknowledged",
        tmdbMetadataFetchedAt: new Date("2026-07-01T00:00:00.000Z"),
      }),
    );
    const conflictConfig =
      db.onConflictDoUpdate.mock.calls[0]?.[0] as
        | {
            set?: {
              alertActive?: unknown;
              alertStartedAt?: unknown;
              alertAcknowledgedGeneration?: unknown;
            };
          }
        | undefined;
    expect(conflictConfig?.set?.alertActive?.constructor?.name).toBe("SQL");
    expect(conflictConfig?.set?.alertStartedAt?.constructor?.name).toBe("SQL");
    expect(
      conflictConfig?.set?.alertAcknowledgedGeneration?.constructor?.name,
    ).toBe("SQL");
    expect(publishScopedWatchUpdates).toHaveBeenCalledWith(
      ["user-1"],
      "watchlist_tv_state_alert_acknowledged",
    );
  });

  it("回傳資料庫實際持久化後的提醒狀態", async () => {
    const db = createDbMock(
      [{ isAnime: 0 }],
      [{ updatedAt: new Date("2026-07-01T00:00:00.000Z") }],
      {
        lastProgress: "watching",
        lastTotalAired: 4,
        lastWatchedCount: 3,
        alertActive: false,
        alertNotifiedWatchCount: 3,
        alertStartedAt: null,
        alertGeneration: "episode:1:4",
        alertAcknowledgedGeneration: "episode:1:4",
        firstReleaseAlertState: null,
        nextEpisodeSeason: 1,
        nextEpisodeNumber: 4,
        nextEpisodeName: "下一集",
        nextEpisodeAirDate: "2026-07-10",
        lastWatchedSeason: 1,
        lastWatchedEpisode: 3,
        checkedAt: new Date("2026-07-04T00:00:00.000Z"),
      },
    );
    getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/watchlist/tv-states/acknowledge", {
        method: "POST",
        body: JSON.stringify({
          tmdbId: 99,
          alertGeneration: "episode:1:4",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.changed).toBe(true);
    expect(payload.persistedState).toEqual({
      tmdb_id: 99,
      last_progress: "watching",
      last_total_aired: 4,
      last_watched_count: 3,
      alert_active: false,
      alert_notified_watch_count: 3,
      next_episode_season: 1,
      next_episode_number: 4,
      next_episode_name: "下一集",
      next_episode_air_date: "2026-07-10",
      last_watched_season: 1,
      last_watched_episode: 3,
      last_checked_at: "2026-07-04T00:00:00.000Z",
      alert_started_at: null,
      alert_generation: "episode:1:4",
      alert_acknowledged_generation: "episode:1:4",
      first_release_alert_state: null,
    });
  });

  it("作品不在使用者清單時維持原狀", async () => {
    const db = createDbMock([]);
    getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/watchlist/tv-states/acknowledge", {
        method: "POST",
        body: JSON.stringify({
          tmdbId: 99,
          alertGeneration: "episode:1:4",
        }),
      }),
    );

    expect(await response.json()).toEqual({ ok: true, changed: false });
    expect(db.insert).not.toHaveBeenCalled();
    expect(publishScopedWatchUpdates).not.toHaveBeenCalled();
  });

  it("同作品存在 TV 與動畫分區時仍會正常發送刷新", async () => {
    const db = createDbMock([
      { isAnime: 0 },
      { isAnime: 1 },
      { isAnime: 1 },
    ]);
    getDb.mockReturnValue(db);

    await POST(
      new Request("http://localhost/api/watchlist/tv-states/acknowledge", {
        method: "POST",
        body: JSON.stringify({
          tmdbId: 99,
          alertGeneration: "episode:1:4",
        }),
      }),
    );

    expect(publishScopedWatchUpdates).toHaveBeenCalledWith(
      ["user-1"],
      "watchlist_tv_state_alert_acknowledged",
    );
  });
});
