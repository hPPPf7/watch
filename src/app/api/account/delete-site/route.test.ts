import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, getDb, publishWatchUpdates } = vi.hoisted(() => ({
  auth: vi.fn(),
  getDb: vi.fn(),
  publishWatchUpdates: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("@/server/db/client", () => ({
  getDb,
}));

vi.mock("@/server/realtime/watchUpdates", () => ({
  publishWatchUpdates,
}));

import { POST } from "@/app/api/account/delete-site/route";

describe("POST /api/account/delete-site", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("刪除站內資料後會通知受影響好友刷新共享紀錄", async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() =>
            Promise.resolve([
              { ownerId: "user-1", targetUserId: "friend-1" },
              { ownerId: "friend-2", targetUserId: "user-1" },
            ])
          ),
        })),
      })),
      execute: vi.fn(() => Promise.resolve()),
    };
    getDb.mockReturnValue(db);

    const response = await POST(
      new Request("http://localhost/api/account/delete-site", {
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(publishWatchUpdates).toHaveBeenCalledWith(
      ["friend-1", "friend-2"],
      "account_delete_site_history_share_cleanup"
    );
  });

  it("刪除已成功後即使 publish 失敗也仍回 200", async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([{ ownerId: "user-1", targetUserId: "friend-1" }])),
        })),
      })),
      execute: vi.fn(() => Promise.resolve()),
    };
    getDb.mockReturnValue(db);
    publishWatchUpdates.mockRejectedValueOnce(new Error("publish failed"));

    const response = await POST(
      new Request("http://localhost/api/account/delete-site", {
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
