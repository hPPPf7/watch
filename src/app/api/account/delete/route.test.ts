import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), getDb: vi.fn(), getAuthDb: vi.fn(),
  runInTransaction: vi.fn(), runInAuthTransaction: vi.fn(), publishWatchUpdates: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/server/db/client", () => mocks);
vi.mock("@/server/realtime/watchUpdates", () => ({ publishWatchUpdates: mocks.publishWatchUpdates }));
import { POST } from "@/app/api/account/delete/route";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function selectRows(results: unknown[][]) {
  return vi.fn(() => ({ from: () => ({ where: () => {
    const result = results.shift() ?? [];
    return Object.assign(Promise.resolve(result), { limit: async () => result });
  } }) }));
}
const insert = () => ({ values: () => ({ onConflictDoUpdate: async () => {} }) });

describe("POST /api/account/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: userId } });
    mocks.getAuthDb.mockReturnValue({ select: () => { throw new Error("Snapshots must use the locked transaction"); } });
    mocks.getDb.mockReturnValue({ select: selectRows([[
      { ownerId: userId, targetUserId: "friend-1" },
      { ownerId: "friend-2", targetUserId: userId },
    ]]) });
    mocks.runInTransaction.mockImplementation(async callback => callback({ execute: async () => {}, insert }));
    mocks.runInAuthTransaction.mockImplementation(async callback => callback({
      execute: async () => {}, insert,
      select: selectRows([
        [],
        [{ id: "map-1", provider: "google", providerAccountId: "provider-1", userId, createdAt: new Date(0) }],
        [],
        [{ userId, sessionVersion: 1, createdAt: new Date(0), updatedAt: new Date(0) }],
      ]),
    }));
  });

  it("notifies affected friends and expires chunked cookies after deletion", async () => {
    const response = await POST(new Request("http://localhost/api/account/delete", {
      method: "POST", headers: { cookie: "__Secure-authjs.session-token.0=old; unrelated=keep" },
    }));
    expect(response.status).toBe(200);
    expect(mocks.publishWatchUpdates).toHaveBeenCalledWith(
      [userId, "friend-1", "friend-2"], "account_delete_history_share_cleanup",
    );
    expect(mocks.runInTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.runInAuthTransaction).toHaveBeenCalledTimes(1);
    expect(response.headers.get("set-cookie")).toContain("__Secure-authjs.session-token.0=");
    expect(response.headers.get("set-cookie")).not.toContain("unrelated=");
  });

  it("rejects deletion confirmation for a different account", async () => {
    const response = await POST(new Request("http://localhost/api/account/delete", {
      method: "POST", headers: { "x-watch-account-id": "different-user" },
    }));
    expect(response.status).toBe(409);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects signed-out callers without touching either database", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await POST(new Request("http://localhost/api/account/delete", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.runInAuthTransaction).not.toHaveBeenCalled();
  });
});
