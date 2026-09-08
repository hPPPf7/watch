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

it("自己重看與好友分享同一集只算一集，保留最新觀看日期", async () => {
  auth.mockResolvedValue({ user: { id: "u" } });
  const row = { tmdbId: 10, seasonNumber: 1, episodeNumber: 1, watchedAt: "2026-01-01", createdAt: "2026-01-01" };
  let index = 0;
  const batches = [[{ ...row, id: "1" }, { ...row, id: "2", watchedAt: "2026-02-01" }], [{ ...row, id: "3" }, { ...row, id: "4", episodeNumber: 2 }]];
  getDb.mockReturnValue({ select: () => ({ from: () => ({ where: async () => batches[index++], innerJoin: () => ({ where: async () => batches[index++] }) }) }) });
  const response = await POST(new Request("https://watch.invalid/api/watchlist/tv-history", { method: "POST", body: JSON.stringify({ tmdbIds: [10] }) }));
  expect(await response.json()).toMatchObject({ watchedCounts: { 10: 2 }, latestWatchedDates: { 10: "2026-02-01" }, latestEpisodes: { 10: { season: 1, episode: 2 } } });
});
