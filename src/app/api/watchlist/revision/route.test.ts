import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, getDb, readWatchlistRevision } = vi.hoisted(() => ({
  auth: vi.fn(),
  getDb: vi.fn(),
  readWatchlistRevision: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("@/server/db/client", () => ({
  getDb,
}));

vi.mock("@/server/realtime/watchUpdates", () => ({
  readWatchlistRevision,
}));

import { GET } from "@/app/api/watchlist/revision/route";

describe("GET /api/watchlist/revision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("在 scoped revision key 過期時，沿用 stateRevision 保持 revision 穩定", async () => {
    getDb.mockReturnValue({
      execute: vi.fn().mockResolvedValue({
        rows: [{ state_revision: "state-sig" }],
      }),
    });
    readWatchlistRevision.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/watchlist/revision?mediaType=movie")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ revision: "state-sig:state-sig" });
  });

  it("只把 getDb 初始化失敗視為 CONFIG_MISSING", async () => {
    getDb.mockImplementation(() => {
      throw new Error("DATABASE_URL_MISSING");
    });

    const response = await GET(
      new Request("http://localhost/api/watchlist/revision?mediaType=movie")
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      code: "CONFIG_MISSING",
      message: "DATABASE_URL is required",
    });
  });

  it("查詢失敗時回 REVISION_FAILED，而不是誤報成設定問題", async () => {
    getDb.mockReturnValue({
      execute: vi.fn().mockRejectedValue(new Error("query failed")),
    });
    readWatchlistRevision.mockResolvedValue("cached");

    const response = await GET(
      new Request("http://localhost/api/watchlist/revision?mediaType=tv&isAnime=true")
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      code: "REVISION_FAILED",
      message: "Failed to load revision",
    });
  });
});
