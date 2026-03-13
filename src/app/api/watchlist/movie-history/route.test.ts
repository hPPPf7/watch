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

import { POST } from "@/app/api/watchlist/movie-history/route";

function createWhereResult(result: unknown) {
  return {
    orderBy: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result)),
  };
}

function createDbMock(selectResults: unknown[]) {
  let selectIndex = 0;
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => createWhereResult(selectResults[selectIndex++] ?? [])),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => createWhereResult(selectResults[selectIndex++] ?? [])),
        })),
      })),
    })),
  };
}

describe("POST /api/watchlist/movie-history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("會先去重 tmdbIds，避免回傳重複列", async () => {
    getDb.mockReturnValue(
      createDbMock([
        [
          {
            id: "history-1",
            tmdb_id: 10,
            watched_at: "2026-03-08T00:00:00.000Z",
            created_at: "2026-03-08T00:00:00.000Z",
            owner_id: "user-1",
          },
        ],
        [],
        [],
      ]),
    );

    const response = await POST(
      new Request("http://localhost/api/watchlist/movie-history", {
        method: "POST",
        body: JSON.stringify({
          tmdbIds: [10, 10],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      rows: [
        {
          tmdb_id: 10,
          watched_at: "2026-03-08",
          owner_id: "user-1",
          watch_count: 1,
          friend_id: "user-1",
          friend_nickname: null,
          is_owner: true,
        },
      ],
    });
  });

  it("查詢失敗時仍維持 JSON 錯誤格式", async () => {
    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => Promise.reject(new Error("db failed"))),
          })),
        })),
      })),
    });

    const response = await POST(
      new Request("http://localhost/api/watchlist/movie-history", {
        method: "POST",
        body: JSON.stringify({
          tmdbIds: [10],
        }),
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      code: "HISTORY_FETCH_FAILED",
      message: "Fetch history failed",
    });
  });
});
