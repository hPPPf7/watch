import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  auth,
  getDb,
  getAuthDb,
  runInTransaction,
  runInAuthTransaction,
  publishWatchUpdates,
} = vi.hoisted(() => ({
  auth: vi.fn(),
  getDb: vi.fn(),
  getAuthDb: vi.fn(),
  runInTransaction: vi.fn(),
  runInAuthTransaction: vi.fn(),
  publishWatchUpdates: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("@/server/db/client", () => ({
  getDb,
  getAuthDb,
  runInTransaction,
  runInAuthTransaction,
}));

vi.mock("@/server/realtime/watchUpdates", () => ({
  publishWatchUpdates,
}));

import { POST } from "@/app/api/account/delete/route";

type TxMock = {
  execute: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
};

describe("POST /api/account/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
    runInTransaction.mockImplementation(async (callback) =>
      callback({
        execute: vi.fn(() => Promise.resolve()),
        insert: vi.fn(() => ({
          values: vi.fn(() => ({
            onConflictDoUpdate: vi.fn(() => Promise.resolve()),
          })),
        })),
      })
    );
    runInAuthTransaction.mockImplementation(async (callback) =>
      callback({
        execute: vi.fn(() => Promise.resolve()),
        insert: vi.fn(() => ({
          values: vi.fn(() => ({
            onConflictDoUpdate: vi.fn(() => Promise.resolve()),
          })),
        })),
      })
    );
  });

  it("刪除帳戶後會通知受影響好友刷新共享紀錄", async () => {
    const shareRows = [
      { ownerId: "user-1", targetUserId: "friend-1" },
      { ownerId: "friend-2", targetUserId: "user-1" },
    ];
    const tx: TxMock = {
      execute: vi.fn(() => Promise.resolve()),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(() => Promise.resolve()),
        })),
      })),
    };
    const watchDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(shareRows)),
        })),
      })),
    };
    const authSelectResults = [
      [
        {
          id: "map-1",
          provider: "google",
          providerAccountId: "provider-1",
          userId: "user-1",
          createdAt: new Date("2026-03-01T00:00:00.000Z"),
        },
      ],
      [],
      [],
    ];
    const authDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            const result = authSelectResults.shift() ?? [];
            return Object.assign(Promise.resolve(result), {
              limit: vi.fn(() => Promise.resolve(result)),
            });
          }),
        })),
      })),
    };
    getDb.mockReturnValue(watchDb);
    getAuthDb.mockReturnValue(authDb);
    runInTransaction.mockImplementation(async (callback) => callback(tx));
    runInAuthTransaction.mockImplementation(async (callback) =>
      callback({
        execute: vi.fn(() => Promise.resolve()),
        insert: vi.fn(() => ({
          values: vi.fn(() => ({
            onConflictDoUpdate: vi.fn(() => Promise.resolve()),
          })),
        })),
      })
    );

    const response = await POST(
      new Request("http://localhost/api/account/delete", {
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(publishWatchUpdates).toHaveBeenCalledWith(
      ["user-1", "friend-1", "friend-2"],
      "account_delete_history_share_cleanup"
    );
    expect(runInTransaction).toHaveBeenCalledTimes(1);
    expect(runInAuthTransaction).toHaveBeenCalledTimes(1);
  });
});
