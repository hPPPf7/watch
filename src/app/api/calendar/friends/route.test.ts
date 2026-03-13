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

import { GET } from "@/app/api/calendar/friends/route";

function createDbMock(error: Error) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => Promise.reject(error)),
        })),
      })),
    })),
  };
}

describe("GET /api/calendar/friends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("查詢失敗時回固定 JSON error contract", async () => {
    getDb.mockReturnValue(createDbMock(new Error("query failed")));

    const response = await GET();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "FRIENDS_LOAD_FAILED",
      message: "Failed to load friends",
    });
  });
});
