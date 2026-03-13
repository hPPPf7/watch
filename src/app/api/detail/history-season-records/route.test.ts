import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, getDb } = vi.hoisted(() => ({
  auth: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("@/server/db/client", () => ({
  getDb,
}));

import { POST } from "@/app/api/detail/history-season-records/route";

function createDbMock(selectResults: unknown[]) {
  let selectIndex = 0;
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => Promise.resolve(selectResults[selectIndex++] ?? [])),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve(resolve(selectResults[selectIndex++] ?? [])),
        })),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => Promise.resolve(selectResults[selectIndex++] ?? [])),
            then: (resolve: (value: unknown) => unknown) =>
              Promise.resolve(resolve(selectResults[selectIndex++] ?? [])),
          })),
        })),
      })),
    })),
  };
}

describe("POST /api/detail/history-season-records", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("會一次回傳整季所有可見 episode history", async () => {
    getDb.mockReturnValue(
      createDbMock([
        [
          {
            id: "own-1",
            watchedAt: new Date("2026-03-01T00:00:00.000Z"),
            ownerId: "user-1",
            episodeNumber: 1,
          },
        ],
        [
          {
            id: "shared-1",
            watchedAt: new Date("2026-03-02T00:00:00.000Z"),
            ownerId: "friend-1",
            episodeNumber: 2,
          },
        ],
        [
          { watchHistoryId: "shared-1", friendId: "user-1" },
          { watchHistoryId: "shared-1", friendId: "friend-1" },
        ],
        [{ friendId: "friend-1", friendNickname: "好友一號" }],
      ]),
    );

    const response = await POST(
      new Request("http://localhost/api/detail/history-season-records", {
        method: "POST",
        body: JSON.stringify({ tmdbId: 200, season: 1 }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      rows: [
        {
          watched_at: "2026-03-01",
          owner_id: "user-1",
          episode_number: 1,
          friend_id: "user-1",
          friend_nickname: null,
          is_owner: true,
        },
        {
          watched_at: "2026-03-02",
          owner_id: "friend-1",
          episode_number: 2,
          friend_id: "friend-1",
          friend_nickname: "好友一號",
          is_owner: true,
        },
        {
          watched_at: "2026-03-02",
          owner_id: "friend-1",
          episode_number: 2,
          friend_id: "user-1",
          friend_nickname: null,
          is_owner: false,
        },
      ],
    });
  });
});
