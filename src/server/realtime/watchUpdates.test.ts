import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthDb, getDb } = vi.hoisted(() => ({
  getAuthDb: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getAuthDb,
  getDb,
}));

import {
  readFriendRevision,
  resolveWatchlistScopedTargets,
} from "@/server/realtime/watchUpdates";

function createSelectDb(rows: Array<{ userId: string; isAnime: number }>) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(rows),
      })),
    })),
  };
}

describe("resolveWatchlistScopedTargets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("保留 movie 的 mediaType，且未在清單中的使用者退回 generic publish", async () => {
    getDb.mockReturnValue(
      createSelectDb([{ userId: "owner", isAnime: 0 }])
    );

    const targets = await resolveWatchlistScopedTargets({
      userIds: ["owner", "friend"],
      mediaType: "movie",
      tmdbId: 123,
    });

    expect(targets).toEqual([
      {
        userId: "owner",
        revisionScopes: [{ mediaType: "movie", isAnime: false }],
      },
      "friend",
    ]);
  });

  it("會合併同一使用者的 tv 分區 scope", async () => {
    getDb.mockReturnValue(
      createSelectDb([
        { userId: "viewer", isAnime: 0 },
        { userId: "viewer", isAnime: 1 },
        { userId: "viewer", isAnime: 1 },
      ])
    );

    const targets = await resolveWatchlistScopedTargets({
      userIds: ["viewer"],
      mediaType: "tv",
      tmdbId: 456,
    });

    expect(targets).toEqual([
      {
        userId: "viewer",
        revisionScopes: [
          { mediaType: "tv", isAnime: false },
          { mediaType: "tv", isAnime: true },
        ],
      },
    ]);
  });
});

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
