import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDb } = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getDb,
}));

import { resolveWatchlistScopedTargets } from "@/server/realtime/watchUpdates";

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
