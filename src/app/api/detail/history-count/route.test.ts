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

import { POST } from "@/app/api/detail/history-count/route";

function createDbMock(selectResults: unknown[]) {
  let selectIndex = 0;
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(selectResults[selectIndex++] ?? [])),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(selectResults[selectIndex++] ?? [])),
        })),
      })),
    })),
  };
}

describe("POST /api/detail/history-count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("會把自己的紀錄與同步給自己的共享紀錄一起計入 count", async () => {
    getDb.mockReturnValue(
      createDbMock([
        [{ id: "own-1" }],
        [
          { seasonNumber: 1, episodeNumber: 1 },
          { seasonNumber: 1, episodeNumber: 2 },
        ],
        [
          { id: "shared-1", seasonNumber: 1, episodeNumber: 2 },
          { id: "shared-2", seasonNumber: 1, episodeNumber: 3 },
        ],
      ]),
    );

    const response = await POST(
      new Request("http://localhost/api/detail/history-count", {
        method: "POST",
        body: JSON.stringify({ mediaType: "tv", tmdbId: 100 }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 3 });
  });
});
