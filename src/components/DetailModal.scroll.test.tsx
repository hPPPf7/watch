// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: { session: { user: { id: "detail-scroll" } }, loading: false },
  profiles: {},
}));
vi.mock("@/hooks/useAuth", () => ({ default: () => state.auth }));
vi.mock("@/hooks/useProfileNames", () => ({ default: () => state.profiles }));
vi.mock("@/hooks/usePageActivityState", () => ({ default: () => false }));
vi.mock("@/hooks/useWatchRealtimeRefresh", () => ({ default: () => {} }));
vi.mock("next/image", () => ({ default: () => null }));
import DetailModal from "./DetailModal";
import { setDetailCache } from "@/lib/tmdbDetailCache";

const episodeNames = ["已看過的開場", "較早漏看的集數", "要編輯的集數"];
const watched = [
  { season_number: 1, episode_number: 1 },
  { season_number: 1, episode_number: 3 },
];
const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
let sequence = 0;
let tmdbId: number;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let scrolls: Array<{ target: Element; options?: boolean | ScrollIntoViewOptions }>;

const render = () => act(async () => root.render(
  <DetailModal open defaultTab="history" mediaType="tv" tmdbId={tmdbId} onClose={() => {}} />,
));
const clickTab = (label: string) => act(async () => {
  const tab = [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === label);
  expect(tab).toBeDefined();
  tab!.click();
});

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("innerWidth", 1200);
  vi.stubGlobal("innerHeight", 900);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  tmdbId = 938710 + sequence++;
  state.auth = { session: { user: { id: `detail-scroll-${tmdbId}` } }, loading: false };
  scrolls = [];
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value(this: Element, options?: boolean | ScrollIntoViewOptions) {
      scrolls.push({ target: this, options });
    },
  });
  setDetailCache(`tv:${tmdbId}`, {
    id: tmdbId,
    media_type: "tv",
    title: "自動捲動測試作品",
    status: "Ended",
    seasons_info: [
      { season_number: 1, episode_count: 3 },
      { season_number: 2, episode_count: 2 },
    ],
    countries: [],
    languages: [],
  });
  setDetailCache(`tv:${tmdbId}:season:1`, episodeNames.map((name, index) => ({
    episode_number: index + 1, name, air_date: "2020-01-01",
  })));
  setDetailCache(`tv:${tmdbId}:season:2`, [
    { episode_number: 1, name: "手動選季的第一集", air_date: "2020-01-01" },
    { episode_number: 2, name: "手動選季的第二集", air_date: "2020-01-01" },
  ]);
  // Every request is handled locally; unexpected routes fail instead of reaching a server.
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) => {
    const path = String(url);
    if (path.endsWith("/bootstrap")) return Response.json({ inWatchlist: true, friends: [] });
    if (path.endsWith("/watchlist-upsert")) return Response.json({ ok: true });
    if (path.endsWith("/history-episodes")) return Response.json({ rows: watched, count: watched.length });
    if (path.endsWith("/history-count")) return Response.json({ count: watched.length });
    if (path.endsWith("/history-season-records")) {
      const { season } = JSON.parse(String(init?.body));
      return Response.json({ rows: watched.filter(row => row.season_number === season).map(row => ({
        episode_number: row.episode_number,
        watched_at: "2026-09-01",
        owner_id: state.auth.session.user.id,
        friend_id: null,
        friend_nickname: null,
        is_owner: true,
      })) });
    }
    throw new Error(`Unexpected request in isolated scroll test: ${path}`);
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  if (originalScrollIntoView) {
    Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
  } else {
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  }
  vi.unstubAllGlobals();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

it("開啟觀看紀錄定位較早漏看的集數，並以整列作為捲動目標", async () => {
  await render();
  expect(host.querySelector<HTMLSelectElement>("select")?.value).toBe("1");
  expect(scrolls).toHaveLength(1);
  const { target, options } = scrolls[0];
  expect(host.contains(target)).toBe(true);
  expect(target.textContent).toContain(episodeNames[1]);
  expect(target.textContent).not.toContain(episodeNames[0]);
  expect(target.textContent).not.toContain(episodeNames[2]);
  expect(target.querySelector('button[aria-label="紀錄觀看日期"]')).not.toBeNull();
  expect(options).toEqual({ block: "start", behavior: "smooth" });
});

it("手動換季後重新開啟紀錄分頁，不被漏看集數的自動定位拉回", async () => {
  await render();
  expect(scrolls[0]?.target.textContent).toContain(episodeNames[1]);
  scrolls.length = 0;
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>("select")!;
    select.value = "2";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(host.querySelector<HTMLSelectElement>("select")?.value).toBe("2");
  expect(host.textContent).toContain("手動選季的第一集");
  // Re-entering history resets the one-time scroll guard, so this also exercises
  // the separate protection for a season the user explicitly selected.
  await clickTab("詳細資料");
  await clickTab("觀看紀錄");
  expect(host.querySelector<HTMLSelectElement>("select")?.value).toBe("2");
  expect(host.textContent).toContain("手動選季的第一集");
  expect(host.textContent).not.toContain(episodeNames[1]);
  expect(scrolls).toHaveLength(0);
});

it("開啟另一集的側邊編輯器時，仍捲到原本的集數列", async () => {
  await render();
  scrolls.length = 0;
  const editButtons = host.querySelectorAll<HTMLButtonElement>('button[aria-label="編輯觀看日期"]');
  expect(editButtons).toHaveLength(2);
  const editButton = editButtons[1];
  await act(async () => editButton.click());
  expect(scrolls).toHaveLength(1);
  const { target, options } = scrolls[0];
  expect(host.contains(target)).toBe(true);
  expect(target.textContent).toContain(episodeNames[2]);
  expect(target.textContent).not.toContain(episodeNames[1]);
  expect(target.contains(editButton)).toBe(true);
  expect(target.querySelector('input[type="date"]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>("#episode-watch-date")?.value).toBe("2026-09-01");
  expect(options).toEqual({ block: "start", behavior: "smooth" });
});
