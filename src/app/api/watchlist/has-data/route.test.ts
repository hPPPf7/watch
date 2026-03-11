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

import { GET } from "@/app/api/watchlist/has-data/route";

function createWhereResult(result: unknown) {
  return {
    limit: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result)),
  };
}

function createDbMock(selectResults: unknown[]) {
  let selectIndex = 0;
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => createWhereResult(selectResults[selectIndex++] ?? [])),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => createWhereResult(selectResults[selectIndex++] ?? [])),
        })),
      })),
    })),
  };
}

describe("GET /api/watchlist/has-data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("不把 orphan share row 當成有效 shared history", async () => {
    getDb.mockReturnValue(
      createDbMock([
        [], // hasWatchlistRows
        [], // hasSectionData
        [], // hasHistoryRows
        [], // hasSharedHistoryRows (join 後無資料)
      ]),
    );

    const response = await GET(
      new Request("http://localhost/api/watchlist/has-data?mediaType=movie"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      hasAnyData: false,
      hasSectionData: false,
    });
  });
});
