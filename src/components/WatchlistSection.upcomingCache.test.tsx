// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: { session: { user: { id: "upcoming-user" } }, loading: false },
  loadSeason: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ default: () => mocks.auth }));
vi.mock("@/hooks/useProfileNames", () => ({ default: () => ({}) }));
vi.mock("@/hooks/usePageActivityState", () => ({ default: () => false }));
vi.mock("@/components/DetailModal", () => ({ default: () => null }));
vi.mock("@/components/WatchlistCard", () => ({ default: () => null }));
vi.mock("@/lib/seasonEpisodes", () => ({
  fetchSeasonEpisodesCached: mocks.loadSeason,
  ensureEpisodeDatesCached: vi.fn(),
}));
import WatchlistSection from "./WatchlistSection";
import { setDetailCache } from "@/lib/tmdbDetailCache";
import { clearWatchUserCache } from "@/lib/clearWatchUserCache";

it.each([false, true])("upcoming snapshot writes only while its account view remains mounted (unmount=%s)", async unmount => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); sessionStorage.clear();
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Electron test");
  const tmdbId = unmount ? 980002 : 980001;
  const row = {
    id: "private-upcoming", tmdb_id: tmdbId, title: "Private upcoming title",
    year: "2020", release_date: "2020-01-01", status: "Returning Series",
    tmdb_cached_at: new Date().toISOString(), poster_path: "/test.jpg",
    media_type: "tv", is_anime: false, created_at: "2020-01-01",
  };
  setDetailCache(`tv:${tmdbId}`, {
    id: tmdbId, media_type: "tv", title: row.title, status: row.status,
    total_episodes: 1, seasons_info: [{ season_number: 1, episode_count: 1 }],
  });
  let finish!: (episodes: unknown[]) => void;
  const season = new Promise<unknown[]>(resolve => { finish = resolve; });
  mocks.loadSeason.mockReset().mockReturnValue(season);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    rows: [row], latestEpisodes: {}, watchedCounts: {}, tvStateRows: [],
    friends: [], hasData: true, hasSectionData: true, revision: "r1",
  })));
  const root = createRoot(document.createElement("div"));
  let mounted = true;
  const key = "watchlist:upcoming-episodes:upcoming-user:tv:false";
  try {
    await act(async () => root.render(<WatchlistSection mediaType="tv" filter="upcoming" />));
    for (let i = 0; i < 20 && mocks.loadSeason.mock.calls.length === 0; i++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    }
    expect(mocks.loadSeason).toHaveBeenCalled();
    if (unmount) {
      await act(async () => root.unmount());
      mounted = false;
      clearWatchUserCache("upcoming-user");
    }
    await act(async () => {
      finish([{ episode_number: 1, name: "Future episode", air_date: "2099-01-01" }]);
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    for (const storage of [localStorage, sessionStorage]) {
      if (unmount) expect(storage.getItem(key)).toBeNull();
      else expect(storage.getItem(key)).toContain(row.title);
    }
  } finally {
    finish([]);
    if (mounted) await act(async () => root.unmount());
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    localStorage.clear(); sessionStorage.clear();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  }
});
