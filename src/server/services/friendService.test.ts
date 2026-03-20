import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getDb,
  runInTransaction,
  publishWatchUpdates,
  publishFriendNoticeUpdates,
} = vi.hoisted(() => ({
  getDb: vi.fn(),
  runInTransaction: vi.fn(),
  publishWatchUpdates: vi.fn(),
  publishFriendNoticeUpdates: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getDb,
  runInTransaction,
}));

vi.mock("@/server/realtime/watchUpdates", () => ({
  publishWatchUpdates,
}));

vi.mock("@/server/realtime/friendNoticeEventBus", () => ({
  publishFriendNoticeUpdates,
}));

import {
  acceptFriendRequest,
  sendFriendRequest,
} from "@/server/services/friendService";

type DeleteReturningBuilder = {
  where: ReturnType<typeof vi.fn<() => DeleteReturningResult>>;
};

type DeletePlainBuilder = {
  where: ReturnType<typeof vi.fn<() => Promise<void>>>;
};

type DeleteReturningResult = {
  returning: () => Promise<{ id: string }[]>;
};

function createSelectMock(results: unknown[]) {
  let index = 0;
  return vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve(results[index++] ?? [])),
      })),
    })),
  }));
}

describe("friendService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runInTransaction.mockImplementation(async (callback) =>
      callback(getDb.mock.results.at(-1)?.value ?? getDb())
    );
  });

  it("sendFriendRequest 會在 transaction 內鎖定使用者對並寫入請求", async () => {
    const tx = {
      execute: vi.fn(() => Promise.resolve()),
      select: createSelectMock([[], [], []]),
      insert: vi.fn(() => ({
        values: vi.fn(() => Promise.resolve()),
      })),
    };
    const db = {
      select: createSelectMock([[{ id: "target-1", nickname: "Friend" }]]),
      transaction: vi.fn(async (callback: (txArg: typeof tx) => Promise<void>) =>
        callback(tx)
      ),
    };
    getDb.mockReturnValue(db);
    runInTransaction.mockImplementation(async (callback) => callback(tx));

    await sendFriendRequest({
      viewerId: "00000000-0000-0000-0000-000000000001",
      targetUserId: "00000000-0000-0000-0000-000000000002",
      viewerNickname: "Viewer",
    });

    expect(runInTransaction).toHaveBeenCalledTimes(1);
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(publishFriendNoticeUpdates).toHaveBeenCalledWith(
      [
        "00000000-0000-0000-0000-000000000001",
        "00000000-0000-0000-0000-000000000002",
      ],
      "friend_request_changed",
    );
  });

  it("acceptFriendRequest 會在 transaction 內刪 request 並建立雙向 friendship", async () => {
    const deleteWithReturning: DeleteReturningBuilder = {
      where: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: "request-1" }])),
      })),
    };
    const deleteWithoutReturning: DeletePlainBuilder = {
      where: vi.fn(() => Promise.resolve()),
    };
    const tx = {
      execute: vi.fn(() => Promise.resolve()),
      delete: vi
        .fn<() => DeleteReturningBuilder | DeletePlainBuilder>()
        .mockImplementationOnce(() => deleteWithReturning)
        .mockImplementationOnce(() => deleteWithoutReturning),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => Promise.resolve()),
        })),
      })),
    };
    const db = {
      select: createSelectMock([
        [{ fromUserId: "00000000-0000-0000-0000-000000000002" }],
        [{ id: "00000000-0000-0000-0000-000000000002", nickname: "Friend" }],
        [{ id: "00000000-0000-0000-0000-000000000001", nickname: "Viewer" }],
      ]),
      transaction: vi.fn(async (callback: (txArg: typeof tx) => Promise<void>) =>
        callback(tx)
      ),
    };
    getDb.mockReturnValue(db);
    runInTransaction.mockImplementation(async (callback) => callback(tx));

    await acceptFriendRequest({
      viewerId: "00000000-0000-0000-0000-000000000001",
      requestId: "00000000-0000-0000-0000-000000000010",
    });

    expect(runInTransaction).toHaveBeenCalledTimes(1);
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(tx.delete).toHaveBeenCalledTimes(2);
    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(publishFriendNoticeUpdates).toHaveBeenCalledWith(
      [
        "00000000-0000-0000-0000-000000000001",
        "00000000-0000-0000-0000-000000000002",
      ],
      "friend_request_changed",
    );
  });
});
