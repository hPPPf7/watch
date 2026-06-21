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

import { POST } from "@/app/api/detail/history-episodes/route";

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

describe("POST /api/detail/history-episodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("會回傳自己的集數與共享給自己的集數", async () => {
    getDb.mockReturnValue(
      createDbMock([
        [{ id: "own-1", season_number: 1, episode_number: 2 }],
        [{ id: "shared-1", season_number: 1, episode_number: 3 }],
      ]),
    );

    const response = await POST(
      new Request("http://localhost/api/detail/history-episodes", {
        method: "POST",
        body: JSON.stringify({ tmdbId: 200 }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      rows: [
        { season_number: 1, episode_number: 2 },
        { season_number: 1, episode_number: 3 },
      ],
      count: 2,
    });
  });
});
