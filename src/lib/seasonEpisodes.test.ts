import { afterEach, describe, expect, it, vi } from "vitest";

const cacheMocks = vi.hoisted(() => ({
  getOrLoadDetailCache: vi.fn(),
  resolveSeasonEpisodesClientTtlMs: vi.fn(() => 1234),
}));

vi.mock("@/lib/tmdbDetailCache", () => cacheMocks);

import { fetchSeasonEpisodesCached } from "./seasonEpisodes";

describe("fetchSeasonEpisodesCached", () => {
  afterEach(() => {
    cacheMocks.getOrLoadDetailCache.mockReset();
    vi.unstubAllGlobals();
  });

  it("強制刷新時同時略過 client cache 與 server cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ episodes: [{ episode_number: 1 }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    cacheMocks.getOrLoadDetailCache.mockImplementation(
      async (_key, loader) => loader(),
    );

    await fetchSeasonEpisodesCached(10, 2, "Returning Series", {
      priority: "background",
      forceRefresh: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tmdb/season?type=tv&id=10&season=2&refresh=1",
    );
    expect(cacheMocks.getOrLoadDetailCache).toHaveBeenCalledWith(
      "tv:10:season:2",
      expect.any(Function),
      1234,
      { priority: "background", skipCache: true },
    );
  });

  it("一般載入維持既有快取路徑", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ episodes: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    cacheMocks.getOrLoadDetailCache.mockImplementation(
      async (_key, loader) => loader(),
    );

    await fetchSeasonEpisodesCached(10, 2, "Returning Series", {
      priority: "background",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tmdb/season?type=tv&id=10&season=2",
    );
    expect(cacheMocks.getOrLoadDetailCache).toHaveBeenCalledWith(
      "tv:10:season:2",
      expect.any(Function),
      1234,
      { priority: "background", skipCache: undefined },
    );
  });
});
