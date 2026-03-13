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

    return {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve(selectResults[selectIndex++] ?? [])),
          })),
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn(() => Promise.resolve(selectResults[selectIndex++] ?? [])),
              })),
            })),
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
          boundary: "2026-03-01T00:00:00.000Z",
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
          boundary: "2026-03-01T00:00:00.000Z",
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
});
