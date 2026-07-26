import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, enforceTmdbProxyRateLimit } = vi.hoisted(() => ({
  auth: vi.fn(),
  enforceTmdbProxyRateLimit: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("@/server/tmdb/calendarMetadata", () => ({
  getCalendarMetadataBatch: vi.fn(),
}));

vi.mock("@/server/tmdb/rateLimit", () => ({
  enforceTmdbProxyRateLimit,
}));

import { POST } from "@/app/api/media/titles/route";
import { getCalendarMetadataBatch } from "@/server/tmdb/calendarMetadata";

const batchEntry = (title: string | null, isAnime = false, refreshAfterMs = 86_400_000) => ({
  metadata: { title, isAnime },
  refreshAfterMs,
});

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/media/titles", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/media/titles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "viewer-id" } });
    enforceTmdbProxyRateLimit.mockReturnValue({
      response: null,
      beforeStart: vi.fn(),
      apply: (response: Response) => response,
    });
  });

  it("未登入回 UNAUTHORIZED", async () => {
    auth.mockResolvedValue(null);
    const response = await post({ items: [] });
    expect(response.status).toBe(401);
  });

  it("非法 media_type 或 tmdb_id 回 BAD_REQUEST", async () => {
    expect((await post({ items: [{ media_type: "book", tmdb_id: 1 }] })).status).toBe(400);
    expect((await post({ items: [{ media_type: "tv", tmdb_id: 0 }] })).status).toBe(400);
    expect((await post({ items: [{ media_type: "tv", tmdb_id: 1.5 }] })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(vi.mocked(getCalendarMetadataBatch)).not.toHaveBeenCalled();
  });

  it("超過上限回 BAD_REQUEST，不會真的去查", async () => {
    const items = Array.from({ length: 201 }, (_, index) => ({
      media_type: "tv",
      tmdb_id: index + 1,
    }));
    expect((await post({ items })).status).toBe(400);
    expect(vi.mocked(getCalendarMetadataBatch)).not.toHaveBeenCalled();
  });

  it("以 mediaType:tmdbId 為 key 回傳標題與是否為動畫", async () => {
    vi.mocked(getCalendarMetadataBatch).mockResolvedValue(
      new Map([
        ["tv:1399", batchEntry("權力遊戲", false)],
        ["tv:1429", batchEntry("進擊的巨人", true)],
      ]),
    );

    const response = await post({
      items: [
        { media_type: "tv", tmdb_id: 1399 },
        { media_type: "tv", tmdb_id: 1429 },
      ],
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      titles: {
        "tv:1399": {
          title: "權力遊戲",
          is_anime: false,
          refresh_after_ms: 86_400_000,
        },
        "tv:1429": {
          title: "進擊的巨人",
          is_anime: true,
          refresh_after_ms: 86_400_000,
        },
      },
    });
  });

  it("同一個 id 重複出現只查一次", async () => {
    vi.mocked(getCalendarMetadataBatch).mockResolvedValue(
      new Map([["tv:1399", batchEntry("權力遊戲")]]),
    );

    await post({
      items: [
        { media_type: "tv", tmdb_id: 1399 },
        { media_type: "tv", tmdb_id: 1399 },
        { media_type: "tv", tmdb_id: 1399 },
      ],
    });

    expect(vi.mocked(getCalendarMetadataBatch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getCalendarMetadataBatch)).toHaveBeenCalledWith(
      [{ mediaType: "tv", tmdbId: 1399 }],
      6,
    );
  });

  it("按去重後的作品數消耗限流額度", async () => {
    const beforeStart = vi.fn();
    enforceTmdbProxyRateLimit.mockReturnValue({
      response: null,
      beforeStart,
      apply: (response: Response) => response,
    });
    vi.mocked(getCalendarMetadataBatch).mockResolvedValue(new Map());

    await post({
      items: [
        { media_type: "tv", tmdb_id: 1 },
        { media_type: "tv", tmdb_id: 1 },
        { media_type: "movie", tmdb_id: 2 },
      ],
    });

    expect(enforceTmdbProxyRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      "viewer-id",
      "detail",
    );
    expect(beforeStart).toHaveBeenCalledTimes(2);
  });

  it("超過限流額度時不查 metadata", async () => {
    const limitedResponse = new Response(
      JSON.stringify({ code: "RATE_LIMITED" }),
      { status: 429 },
    );
    enforceTmdbProxyRateLimit.mockReturnValue({
      response: limitedResponse,
      beforeStart: vi.fn(() => {
        throw new Error("RATE_LIMITED");
      }),
      apply: (response: Response) => response,
    });

    const response = await post({
      items: [{ media_type: "tv", tmdb_id: 1 }],
    });

    expect(response.status).toBe(429);
    expect(vi.mocked(getCalendarMetadataBatch)).not.toHaveBeenCalled();
  });

  it("查不到標題的作品不會讓整批失敗，只是那個 key 缺席", async () => {
    vi.mocked(getCalendarMetadataBatch).mockResolvedValue(
      new Map([["tv:1399", batchEntry("權力遊戲")]]),
    );

    const response = await post({
      items: [
        { media_type: "tv", tmdb_id: 1399 },
        { media_type: "movie", tmdb_id: 999 },
      ],
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      titles: {
        "tv:1399": {
          title: "權力遊戲",
          is_anime: false,
          refresh_after_ms: 86_400_000,
        },
      },
    });
  });

  it("空白標題正規化成 null，不會變成空字串", async () => {
    vi.mocked(getCalendarMetadataBatch).mockResolvedValue(
      new Map([["tv:1399", batchEntry("   ")]]),
    );

    const response = await post({ items: [{ media_type: "tv", tmdb_id: 1399 }] });
    expect(await response.json()).toEqual({
      titles: {
        "tv:1399": {
          title: null,
          is_anime: false,
          refresh_after_ms: 86_400_000,
        },
      },
    });
  });
});
