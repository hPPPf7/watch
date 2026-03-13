import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, getDb, getWatchlistCardMetadataBatch } = vi.hoisted(() => ({
  auth: vi.fn(),
  getDb: vi.fn(),
  getWatchlistCardMetadataBatch: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("@/server/db/client", () => ({
  getDb,
}));

vi.mock("@/server/tmdb/watchlistCardMetadata", () => ({
  getWatchlistCardMetadataBatch,
}));

import { GET } from "@/app/api/watchlist/items/route";

function createDbMock(result: unknown) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() =>
            result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
          ),
        })),
      })),
    })),
  };
}

describe("GET /api/watchlist/items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("查詢失敗時回固定 JSON error contract", async () => {
    getDb.mockReturnValue(createDbMock(new Error("query failed")));

    const response = await GET(
      new Request("http://localhost/api/watchlist/items?mediaType=movie"),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "ITEMS_LOAD_FAILED",
      message: "Failed to load watchlist items",
    });
  });

  it("metadata 載入失敗時也回固定 JSON error contract", async () => {
    getDb.mockReturnValue(
      createDbMock([
        {
          id: "item-1",
          tmdb_id: 10,
          media_type: "movie",
          is_anime: 0,
          created_at: new Date("2026-03-09T00:00:00.000Z"),
        },
      ]),
    );
    getWatchlistCardMetadataBatch.mockRejectedValueOnce(new Error("cache failed"));

    const response = await GET(
      new Request("http://localhost/api/watchlist/items?mediaType=movie"),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "ITEMS_LOAD_FAILED",
      message: "Failed to load watchlist items",
    });
  });
});
