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

import { POST } from "@/app/api/watchlist/tv-history/route";

describe("POST /api/watchlist/tv-history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("查詢失敗時仍維持 JSON 錯誤格式", async () => {
    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.reject(new Error("db failed"))),
        })),
      })),
    });

    const response = await POST(
      new Request("http://localhost/api/watchlist/tv-history", {
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
