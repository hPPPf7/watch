// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ auth: { session: { user: { id: "loading-test" } }, loading: false }, profiles: {}, detail: { id: 1, media_type: "movie", title: "Test", year: "2020", release_date: "2020-01-01", is_anime: false, runtime: 90, countries: [], languages: [], overview: null, poster_path: null, homepage: null } }));
vi.mock("@/hooks/useAuth", () => ({ default: () => state.auth }));
vi.mock("@/hooks/useProfileNames", () => ({ default: () => state.profiles }));
vi.mock("@/hooks/usePageActivityState", () => ({ default: () => true }));
vi.mock("@/hooks/useWatchRealtimeRefresh", () => ({ default: () => {} }));
vi.mock("@/components/SiteHeader", () => ({ default: () => null }));
vi.mock("@/components/SiteFooter", () => ({ default: () => null }));
vi.mock("@/components/RequireAuthGate", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/lib/tmdbDetailCache", () => ({
 subscribeDetailCache: () => () => {}, getDetailCacheVersion: () => 0, getDetailCache: () => state.detail, getOrLoadDetailCache: async () => state.detail, setDetailCache: () => {}, DEFAULT_DETAIL_TTL_MS: 1000, SHORT_DETAIL_TTL_MS: 1000 }));
import DetailModal from "./DetailModal";
import Calendar from "@/app/calendar/page";
let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = "<div id='test'></div>"; root = createRoot(document.getElementById("test")!);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ inWatchlist: false, friends: [], rows: [], historyRows: [], watchlistItems: [] })));
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); globalThis.IS_REACT_ACT_ENVIRONMENT = false; });
it("詳情加入清單斷線後可再次操作", async () => {
  await act(async () => { root.render(<DetailModal open onClose={() => {}} mediaType="movie" tmdbId={1} />); });
  const fetch = vi.mocked(globalThis.fetch);
  fetch.mockRejectedValue(new TypeError("offline"));
  const button = document.querySelector<HTMLButtonElement>('button[aria-label="加入清單"]')!;
  expect(button).not.toBeNull();
  const before = fetch.mock.calls.length;
  await act(async () => button.click());
  expect(document.body.textContent).toContain("操作失敗，請稍後再試。");
  await act(async () => button.click());
  expect(fetch.mock.calls.length - before).toBe(2);
});
it("月曆跳月斷線後恢復按鈕並可重試", async () => {
  await act(async () => root.render(<Calendar />));
  const fetch = vi.mocked(globalThis.fetch);
  fetch.mockRejectedValue(new TypeError("offline"));
  const button = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "下個月")!;
  expect(button).toBeDefined();
  await act(async () => button.click());
  expect(button.disabled).toBe(false); expect(document.body.textContent).toContain("月份切換失敗，請稍後再試。");
  const before = fetch.mock.calls.length;
  await act(async () => button.click());
  expect(fetch.mock.calls.length).toBeGreaterThan(before); expect(button.disabled).toBe(false);
});
