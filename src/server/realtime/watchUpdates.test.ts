import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAuthDb,
  getDb,
  publishWatchUpdateEvent,
  readRedisJson,
  writeRedisJson,
} = vi.hoisted(() => ({
  getAuthDb: vi.fn(),
  getDb: vi.fn(),
  publishWatchUpdateEvent: vi.fn(),
  readRedisJson: vi.fn(),
  writeRedisJson: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getAuthDb,
  getDb,
}));

vi.mock("@/server/realtime/redis", () => ({
  isRedisRealtimeEnabled: () => true,
  readRedisJson,
  writeRedisJson,
}));

vi.mock("@/server/realtime/watchEventBus", () => ({
  publishWatchUpdateEvent,
}));

vi.mock("@/server/realtime/deferredPublish", () => ({
  runDeferredPublish: (
    task: () => Promise<void>,
    onError: (error: unknown) => void,
  ) => {
    void task().catch(onError);
  },
}));

import {
  publishScopedWatchUpdates,
  readFriendRevision,
  readLatestWatchUpdate,
} from "@/server/realtime/watchUpdates";

function createWhereChain(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(rows),
    })),
  };
}

describe("readFriendRevision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fallback revision 會使用 profile 暱稱而不是舊的 friend nickname", async () => {
    const friendRows = [
      {
        userId: "viewer",
        friendId: "friend",
        friendNickname: "舊暱稱",
        createdAt: new Date("2026-06-18T00:00:00.000Z"),
      },
    ];
    const watchDb = {
      select: vi.fn()
        .mockReturnValueOnce(createWhereChain(friendRows))
        .mockReturnValueOnce(createWhereChain(friendRows)),
    };
    const authDb = {
      select: vi.fn(() => createWhereChain([
        {
          id: "friend",
          nickname: "新暱稱",
          avatarUrl: null,
        },
      ])),
    };
    getDb.mockReturnValue(watchDb);
    getAuthDb.mockReturnValue(authDb);

    const firstRevision = await readFriendRevision("viewer");

    authDb.select.mockReturnValue(createWhereChain([
      {
        id: "friend",
        nickname: "更新後暱稱",
        avatarUrl: null,
      },
    ]));
    const secondRevision = await readFriendRevision("viewer");

    expect(firstRevision).not.toBe("0");
    expect(secondRevision).not.toBe(firstRevision);
  });

  it("fallback revision 不會因為暱稱包含分隔符而碰撞", async () => {
    const firstFriendRows = [
      {
        userId: "viewer",
        friendId: "friend-a",
        friendNickname: "a|b",
        createdAt: new Date("2026-06-18T00:00:00.000Z"),
      },
      {
        userId: "viewer",
        friendId: "friend-b",
        friendNickname: "c",
        createdAt: new Date("2026-06-18T00:00:01.000Z"),
      },
    ];
    const secondFriendRows = [
      {
        userId: "viewer",
        friendId: "friend-a",
        friendNickname: "a",
        createdAt: new Date("2026-06-18T00:00:00.000Z"),
      },
      {
        userId: "viewer",
        friendId: "friend-b",
        friendNickname: "b|c",
        createdAt: new Date("2026-06-18T00:00:01.000Z"),
      },
    ];
    const watchDb = {
      select: vi.fn()
        .mockReturnValueOnce(createWhereChain(firstFriendRows))
        .mockReturnValueOnce(createWhereChain(secondFriendRows)),
    };
    const authDb = {
      select: vi.fn(() => createWhereChain([])),
    };
    getDb.mockReturnValue(watchDb);
    getAuthDb.mockReturnValue(authDb);

    const firstRevision = await readFriendRevision("viewer");
    const secondRevision = await readFriendRevision("viewer");

    expect(secondRevision).not.toBe(firstRevision);
  });
});

describe("readLatestWatchUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeRedisJson.mockResolvedValue(true);
  });

  const createLimitChain = (rows: unknown[]) => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(rows),
        })),
      })),
    })),
  });

  it("Redis 有有效紀錄時直接回傳，不查 DB", async () => {
    const record = { reason: "history_upsert", at: 123, nonce: "n1" };
    readRedisJson.mockResolvedValue(record);

    const result = await readLatestWatchUpdate("user-1");

    expect(result).toEqual(record);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("Redis miss 時 fallback DB，並以 ifAbsent 回填 Redis", async () => {
    const record = { reason: "watchlist_upsert", at: 456, nonce: "n2" };
    readRedisJson.mockResolvedValue(null);
    getDb.mockReturnValue(
      createLimitChain([
        {
          payload: record,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ]),
    );

    const result = await readLatestWatchUpdate("user-1");

    expect(result).toEqual(record);
    expect(writeRedisJson).toHaveBeenCalledWith(
      "watch:updates:user-1",
      record,
      expect.any(Number),
      { ifAbsent: true },
    );
  });

  it("DB 紀錄已過期時回 null 且不回填", async () => {
    readRedisJson.mockResolvedValue(null);
    getDb.mockReturnValue(
      createLimitChain([
        {
          payload: { reason: "history_upsert", at: 1, nonce: "n3" },
          expiresAt: new Date(Date.now() - 1_000).toISOString(),
        },
      ]),
    );

    const result = await readLatestWatchUpdate("user-1");

    expect(result).toBeNull();
    expect(writeRedisJson).not.toHaveBeenCalled();
  });
});

describe("publishScopedWatchUpdates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeRedisJson.mockResolvedValue(true);
    publishWatchUpdateEvent.mockResolvedValue(undefined);
  });

  const flushDeferred = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("整批使用者只跑一趟多列 upsert，事件由 RETURNING 的 payload 建立", async () => {
    const returnedRows = [
      {
        key: "watch:updates:user-1",
        payload: { reason: "history_upsert", at: 111, nonce: "n1" },
      },
      {
        key: "watch:updates:user-2",
        payload: { reason: "history_upsert", at: 111, nonce: "n2" },
      },
    ];
    const returning = vi.fn().mockResolvedValue(returnedRows);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn((rows: unknown[]) => {
      void rows;
      return { onConflictDoUpdate };
    });
    const insert = vi.fn(() => ({ values }));
    getDb.mockReturnValue({ insert });

    await publishScopedWatchUpdates(["user-1", "user-2", "user-1"], "history_upsert");
    await flushDeferred();

    // 兩個使用者（含去重）只呼叫一次 insert：單一往返。
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values.mock.calls[0][0]).toHaveLength(2);

    expect(writeRedisJson).toHaveBeenCalledWith(
      "watch:updates:user-1",
      { reason: "history_upsert", at: 111, nonce: "n1" },
      24 * 60 * 60 * 1000,
    );
    expect(publishWatchUpdateEvent).toHaveBeenCalledWith({
      userId: "user-2",
      reason: "history_upsert",
      at: 111,
      nonce: "n2",
    });

    // Redis 快取必須在 pub/sub 事件之前寫完，否則客戶端收到事件後
    // 可能讀到舊的 latest record。
    const firstRedisWriteOrder = writeRedisJson.mock.invocationCallOrder[0];
    const firstPublishOrder = publishWatchUpdateEvent.mock.invocationCallOrder[0];
    expect(firstRedisWriteOrder).toBeLessThan(firstPublishOrder);
  });

  it("upsert 失敗時不丟錯、也不送任何事件", async () => {
    const returning = vi.fn().mockRejectedValue(new Error("db down"));
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    getDb.mockReturnValue({ insert: vi.fn(() => ({ values })) });

    await expect(
      publishScopedWatchUpdates(["user-1"], "history_upsert"),
    ).resolves.toBeUndefined();
    await flushDeferred();

    expect(writeRedisJson).not.toHaveBeenCalled();
    expect(publishWatchUpdateEvent).not.toHaveBeenCalled();
  });
});
