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

import { POST } from "@/app/api/calendar/edge/route";

describe("POST /api/calendar/edge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "viewer-id" } });
  });

  function createDbMock(selectResults: unknown[]) {
    let selectIndex = 0;
    const nextResult = () => selectResults[selectIndex++] ?? [];
    const createOrderResult = () => ({
      limit: vi.fn(() => Promise.resolve(nextResult())),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(resolve(nextResult())),
    });
    const createWhereResult = () => ({
      orderBy: vi.fn(() => createOrderResult()),
      limit: vi.fn(() => Promise.resolve(nextResult())),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(resolve(nextResult())),
    });

    return {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => createWhereResult()),
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => createWhereResult()),
          })),
        })),
      })),
    };
  }

  it("非法 selectedFriendId 會直接回 BAD_REQUEST", async () => {
    const response = await POST(
      new Request("http://localhost/api/calendar/edge", {
        method: "POST",
        body: JSON.stringify({
          boundary: "2026-03-01",
          direction: 1,
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

  it("指定非好友 selectedFriendId 會直接回 FORBIDDEN", async () => {
    getDb.mockReturnValue(createDbMock([[]]));

    const response = await POST(
      new Request("http://localhost/api/calendar/edge", {
        method: "POST",
        body: JSON.stringify({
          boundary: "2026-03-01",
          direction: 1,
          selectedFriendId: "11111111-1111-1111-1111-111111111111",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: "FORBIDDEN",
      message: "Friend is not accessible",
    });
  });

  it("回傳 edge 時只帶 date-only 字串", async () => {
    getDb.mockReturnValue(
      createDbMock([
        [],
        [{ watched_at: "2026-03-08 00:00:00+00" }],
        [{ history_id: "history-1", watched_at: "2026-03-10 00:00:00+00" }],
      ]),
    );

    const response = await POST(
      new Request("http://localhost/api/calendar/edge", {
        method: "POST",
        body: JSON.stringify({
          boundary: "2026-03-01",
          direction: 1,
          selectedFriendId: "all",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      edge: "2026-03-08",
    });
  });

  it("edge 不會因 UTC 截斷把帶 offset 的日期移到前一天", async () => {
    getDb.mockReturnValue(
      createDbMock([
        [],
        [{ watched_at: "2026-03-01 00:30:00+08" }],
        [{ history_id: "history-1", watched_at: "2026-03-10 00:00:00+08" }],
      ]),
    );

    const response = await POST(
      new Request("http://localhost/api/calendar/edge", {
        method: "POST",
        body: JSON.stringify({
          boundary: "2026-03-01",
          direction: 1,
          selectedFriendId: "all",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      edge: "2026-03-01",
    });
  });

  it("多選好友 edge 會把同步紀錄的共享對象算進參與者", async () => {
    const ownerId = "11111111-1111-1111-1111-111111111111";
    const friendBId = "22222222-2222-2222-2222-222222222222";
    getDb.mockReturnValue(
      createDbMock([
        [{ friend_id: ownerId }, { friend_id: friendBId }],
        [],
        [
          {
            history_id: "history-1",
            watched_at: "2026-03-10 00:00:00+00",
          },
        ],
        [
          {
            history_id: "history-1",
            owner_id: ownerId,
            target_user_id: "viewer-id",
          },
          {
            history_id: "history-1",
            owner_id: ownerId,
            target_user_id: friendBId,
          },
        ],
      ]),
    );

    const response = await POST(
      new Request("http://localhost/api/calendar/edge", {
        method: "POST",
        body: JSON.stringify({
          boundary: "2026-03-01",
          direction: 1,
          selectedFriendIds: [friendBId],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      edge: "2026-03-10",
    });
  });
});
