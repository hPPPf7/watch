// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ epoch: 1, inactive: false, auth: { session: null, loading: false }, profiles: {} }));
vi.mock("@/hooks/useAuth", () => ({ default: () => state.auth }));
vi.mock("@/hooks/useProfileNames", () => ({ default: () => state.profiles }));
vi.mock("@/hooks/usePageActivityState", () => ({ default: () => state.inactive }));
vi.mock("@/hooks/useWatchRealtimeRefresh", () => ({ default: () => {} }));
vi.mock("@/hooks/useEpisodeDataClock", () => ({ default: () => ({ today: "2026-09-11", refreshEpoch: state.epoch }) }));
import DetailModal from "./DetailModal";
import { setDetailCache } from "@/lib/tmdbDetailCache";
afterEach(() => { vi.unstubAllGlobals(); globalThis.IS_REACT_ACT_ENVIRONMENT = false; });
it("詳情採用其他畫面更新的快取，定期檢查不再顯示舊內容且不另抓 TMDB", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ episodes: [], rows: [], friends: [] }));
  vi.stubGlobal("fetch", fetcher);
  const id = 992813;
  const detail = { id, media_type: "tv", title: "原本片名", year: "2026", status: "Returning Series", seasons_info: [{ season_number: 1, episode_count: 2 }], countries: [], languages: [] };
  setDetailCache(`tv:${id}`, detail);
  setDetailCache(`tv:${id}:season:1`, [{ episode_number: 1, name: "第一集", air_date: "2026-09-01" }]);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const render = () => root.render(<DetailModal open mediaType="tv" tmdbId={id} onClose={() => {}} />);
  try {
    await act(async () => render());
    expect(host.textContent).toContain("原本片名");
    await act(async () => { setDetailCache(`tv:${id}`, { ...detail, title: "更新片名" }); state.epoch++; render(); });
    expect(host.textContent).toContain("更新片名");
    expect(host.textContent).not.toContain("原本片名");
    expect(fetcher.mock.calls.filter(args => String(args[0]).includes("/api/tmdb/"))).toHaveLength(0);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
