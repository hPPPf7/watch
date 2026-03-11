import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, getDb, runInTransaction, publishWatchUpdates } = vi.hoisted(() => ({
  auth: vi.fn(),
  getDb: vi.fn(),
  runInTransaction: vi.fn(),
  publishWatchUpdates: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("@/server/db/client", () => ({
  getDb,
  runInTransaction,
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
  });

  it("刪除帳戶後會通知受影響好友刷新共享紀錄", async () => {
    const selectResults = [
      [{ provider: "google", providerAccountId: "provider-1" }],
      [
        { ownerId: "user-1", targetUserId: "friend-1" },
        { ownerId: "friend-2", targetUserId: "user-1" },
      ],
    ];
    const tx: TxMock = {
      execute: vi.fn(() => Promise.resolve()),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(() => Promise.resolve()),
        })),
      })),
    };
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(selectResults.shift() ?? [])),
        })),
      })),
    };
    getDb.mockReturnValue(db);
    runInTransaction.mockImplementation(async (callback) => callback(tx));

    const response = await POST(
      new Request("http://localhost/api/account/delete", {
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(publishWatchUpdates).toHaveBeenCalledWith(
      ["friend-1", "friend-2"],
      "account_delete_history_share_cleanup"
    );
    expect(runInTransaction).toHaveBeenCalledTimes(1);
  });
});
