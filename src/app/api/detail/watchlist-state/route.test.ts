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

import { POST } from "@/app/api/detail/watchlist-state/route";

function createDbMock(selectResults: unknown[]) {
  let selectIndex = 0;
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(selectResults[selectIndex++] ?? [])),
        })),
      })),
    })),
  };
}

describe("POST /api/detail/watchlist-state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("TV 條目會依 isAnime 精準判斷目前分區是否在清單內", async () => {
    getDb.mockReturnValue(createDbMock([[]]));

    const response = await POST(
      new Request("http://localhost/api/detail/watchlist-state", {
        method: "POST",
        body: JSON.stringify({
          mediaType: "tv",
          tmdbId: 77,
          isAnime: true,
        }),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ inWatchlist: false });
  });
});
