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

import { POST } from "@/app/api/detail/watchlist-map/route";

describe("POST /api/detail/watchlist-map", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("遇到非法 tmdbIds 時回 BAD_REQUEST", async () => {
    const response = await POST(
      new Request("http://localhost/api/detail/watchlist-map", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "tv",
          tmdbIds: [1, -2, 3.5, null],
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
});
