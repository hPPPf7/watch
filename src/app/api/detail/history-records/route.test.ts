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

import { POST } from "@/app/api/detail/history-records/route";

describe("POST /api/detail/history-records", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("電影帶入非 0 season/episode 時會直接回 BAD_REQUEST", async () => {
    const response = await POST(
      new Request("http://localhost/api/detail/history-records", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "movie",
          tmdbId: 10,
          season: 1,
          episode: 1,
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

  it("查詢失敗時回固定 JSON error contract", async () => {
    getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => Promise.reject(new Error("query failed"))),
          })),
        })),
      })),
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(
      new Request("http://localhost/api/detail/history-records", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "movie",
          tmdbId: 10,
          season: 0,
          episode: 0,
        }),
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "HISTORY_RECORDS_FAILED",
      message: "Failed to load history records",
    });
  });
});
