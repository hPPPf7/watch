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
) {
  const where = vi.fn(() => Promise.resolve(rows));
  const onConflictDoUpdate = vi.fn(() => Promise.resolve());
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
      [
        {
          userId: "user-1",
          revisionScopes: [{ mediaType: "tv", isAnime: true }],
        },
      ],
      "watchlist_tv_state_alert_acknowledged",
    );
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

  it("同作品存在 TV 與動畫分區時會刷新兩個 scope", async () => {
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
      [
        {
          userId: "user-1",
          revisionScopes: [
            { mediaType: "tv", isAnime: false },
            { mediaType: "tv", isAnime: true },
          ],
        },
      ],
      "watchlist_tv_state_alert_acknowledged",
    );
  });
});
