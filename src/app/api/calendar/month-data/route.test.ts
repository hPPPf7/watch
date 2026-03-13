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

vi.mock("@/server/tmdb/calendarMetadata", () => ({
  getCalendarMetadata: vi.fn(),
}));

import { POST } from "@/app/api/calendar/month-data/route";

describe("POST /api/calendar/month-data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "viewer-id" } });
  });

  function createDbMock(selectResults: unknown[]) {
    let selectIndex = 0;

    return {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(selectResults[selectIndex++] ?? [])),
          innerJoin: vi.fn(() => ({
            where: vi.fn(() =>
              Promise.resolve(selectResults[selectIndex++] ?? []),
            ),
          })),
        })),
      })),
    };
  }

  it("非法 selectedFriendId 會直接回 BAD_REQUEST", async () => {
    const response = await POST(
      new Request("http://localhost/api/calendar/month-data", {
        method: "POST",
        body: JSON.stringify({
          year: 2026,
          month: 2,
          selectedFriendId: "abc",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "BAD_REQUEST",
      message: "Invalid payload",
    });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("all 模式會保留同一筆 history 的完整 share rows，讓之後成為好友時能補顯示", async () => {
    getDb.mockReturnValue(
      createDbMock([
        [],
        [],
        [],
        [{ friend_id: "owner-id" }, { friend_id: "friend-2" }],
        [{ history_id: "history-1" }],
        [
          {
            history_id: "history-1",
            tmdb_id: 10,
            media_type: "movie",
            season_number: null,
            episode_number: null,
            watched_at: new Date("2026-03-01T00:00:00.000Z"),
            owner_id: "owner-id",
            target_user_id: "viewer-id",
          },
          {
            history_id: "history-1",
            tmdb_id: 10,
            media_type: "movie",
            season_number: null,
            episode_number: null,
            watched_at: new Date("2026-03-01T00:00:00.000Z"),
            owner_id: "owner-id",
            target_user_id: "friend-2",
          },
        ],
        [],
        [],
      ]),
    );

    const response = await POST(
      new Request("http://localhost/api/calendar/month-data", {
        method: "POST",
        body: JSON.stringify({
          year: 2026,
          month: 2,
          selectedFriendId: "all",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      rows: [
        expect.objectContaining({
          history_id: "history-1",
          companion_id: "viewer-id",
        }),
        expect.objectContaining({
          history_id: "history-1",
          companion_id: "friend-2",
        }),
      ],
    });
  });

  it("all 模式不會把非好友的第三人 participant id 帶到前端", async () => {
    getDb.mockReturnValue(
      createDbMock([
        [],
        [],
        [],
        [{ friend_id: "owner-id" }],
        [{ history_id: "history-1" }],
        [
          {
            history_id: "history-1",
            tmdb_id: 10,
            media_type: "movie",
            season_number: null,
            episode_number: null,
            watched_at: new Date("2026-03-01T00:00:00.000Z"),
            owner_id: "owner-id",
            target_user_id: "viewer-id",
          },
          {
            history_id: "history-1",
            tmdb_id: 10,
            media_type: "movie",
            season_number: null,
            episode_number: null,
            watched_at: new Date("2026-03-01T00:00:00.000Z"),
            owner_id: "owner-id",
            target_user_id: "stranger-id",
          },
        ],
        [],
        [],
      ]),
    );

    const response = await POST(
      new Request("http://localhost/api/calendar/month-data", {
        method: "POST",
        body: JSON.stringify({
          year: 2026,
          month: 2,
          selectedFriendId: "all",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      rows: [
        expect.objectContaining({
          history_id: "history-1",
          companion_id: "viewer-id",
        }),
      ],
    });
  });
});
