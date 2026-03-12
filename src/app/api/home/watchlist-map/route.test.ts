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

import { POST } from "@/app/api/home/watchlist-map/route";

describe("POST /api/home/watchlist-map", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("遇到非法 ids 陣列時回 BAD_REQUEST", async () => {
    const response = await POST(
      new Request("http://localhost/api/home/watchlist-map", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "movie",
          ids: ["x", null],
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "BAD_REQUEST",
      message: "Invalid ids",
    });
    expect(getDb).not.toHaveBeenCalled();
  });
});
