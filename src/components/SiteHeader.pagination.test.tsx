// @vitest-environment jsdom
import { act, StrictMode, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SearchResult } from "@/features/site-header/useMediaSearch";
import { WATCH_STATUS_REFRESH_EVENT } from "@/lib/watchStatusEvents";

const mocks = vi.hoisted(() => ({ auth: { session: { user: { id: "pagination-user" } }, loading: false } }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/movies" }));
vi.mock("next/link", () => ({ default: ({ children, href }: ComponentProps<"a">) => <a href={href}>{children}</a> }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/hooks/useAuth", () => ({ default: () => mocks.auth }));
vi.mock("@/hooks/usePageActivityState", () => ({ default: () => false }));
vi.mock("@/hooks/useWatchRealtimeRefresh", () => ({ default: () => {} }));
vi.mock("@/features/site-header/usePendingFriendCount", () => ({ default: () => 0 }));
vi.mock("@/components/DetailModal", () => ({ default: () => null }));
import SiteHeader from "./SiteHeader";

type PrivateCall = { url: string; body: { mediaType?: string; isAnime?: boolean; ids?: number[]; movieIds?: number[]; tvIds?: number[]; animeIds?: number[] } };
let host: HTMLDivElement;
let slot: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let calls: PrivateCall[];
const item = (id: number, media_type: "movie" | "tv" = "movie", is_anime = false): SearchResult => ({
  id, media_type, is_anime, title: `作品 ${id}`, year: "2026", release_date: null, poster_path: null,
});
const deferred = () => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
};
const mapCalls = () => calls.filter((call) => call.url.endsWith("watchlist-map"));
const statusCalls = () => calls.filter((call) => call.url.endsWith("watch-status"));
const statusIds = (call: PrivateCall) => [...call.body.movieIds ?? [], ...call.body.tvIds ?? [], ...call.body.animeIds ?? []];
const star = (id: number) => slot.querySelector<HTMLButtonElement>(`button[aria-label="查看 作品 ${id} 詳情"]`)!.closest("li")!.querySelector<HTMLButtonElement>('button[aria-busy]')!;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  calls = [];
  host = document.createElement("div");
  slot = document.createElement("div");
  slot.id = "search-results-slot";
  document.body.append(host, slot);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  slot.remove();
  delete document.body.dataset.searchOpen;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

function installFetch(pages: SearchResult[][], readPrivate?: (call: PrivateCall) => Response | Promise<Response> | undefined) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/tmdb/search")) {
      const page = Number(new URL(url, "http://localhost").searchParams.get("page"));
      return Response.json({ results: pages[page - 1], page, total_pages: pages.length });
    }
    if (url.endsWith("watchlist-map") || url.endsWith("watch-status")) {
      const call = { url, body: JSON.parse(String(init?.body)) } as PrivateCall;
      calls.push(call);
      const result = readPrivate?.(call);
      if (result) return result;
      return Response.json(url.endsWith("watchlist-map") ? { activeIds: [] } : { statusMap: {} });
    }
    return Response.json({ avatarUrl: null });
  }));
}
const clickText = (text: string) => act(async () => {
  [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === text)!.click();
});
const open = () => act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="搜尋"]')!.click());
const search = async (query: string) => {
  await act(async () => root.render(<StrictMode><SiteHeader /></StrictMode>));
  await open();
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => vi.advanceTimersByTimeAsync(450));
};

it("looks up only appended identities in their movie, TV and anime scopes", async () => {
  installFetch([
    [item(8), item(11, "tv"), item(12, "tv", true)],
    [item(8), item(9), item(13, "tv"), item(14, "tv", true)],
  ]);
  await search("pagination-scopes");
  calls.length = 0;
  await clickText("載入更多");
  expect(mapCalls().map((call) => call.body)).toEqual([
    { mediaType: "movie", isAnime: false, ids: [9] },
    { mediaType: "tv", isAnime: false, ids: [13] },
    { mediaType: "tv", isAnime: true, ids: [14] },
  ]);
  expect(statusCalls().map((call) => call.body)).toEqual([{ movieIds: [9], tvIds: [13], animeIds: [14] }]);
  expect(slot.textContent).toContain("目前載入 6 部");
});

it("keeps earlier private reads valid and loading until they settle while a later page finishes", async () => {
  const oldMap = deferred();
  const oldStatus = deferred();
  installFetch([[item(21)], [item(22)]], (call) => {
    if (call.body.ids?.includes(21)) return oldMap.promise;
    if (call.body.movieIds?.includes(21)) return oldStatus.promise;
  });
  await search("pagination-overlap");
  await clickText("載入更多");
  expect(mapCalls().map((call) => call.body.ids)).toEqual([[21], [22]]);
  expect(statusCalls().map(statusIds)).toEqual([[21], [22]]);
  expect(star(21).disabled).toBe(true);
  expect(star(22).getAttribute("aria-label")).toBe("加入清單");
  expect(slot.textContent).toContain("正在確認清單與觀看狀態");
  await act(async () => oldMap.resolve(Response.json({ activeIds: [21] })));
  expect(star(21).getAttribute("aria-label")).toBe("移除清單");
  expect(slot.textContent).toContain("正在確認清單與觀看狀態");
  await act(async () => oldStatus.resolve(Response.json({ statusMap: { "movie:series:21": "completed" } })));
  expect(slot.textContent).toContain("已看完");
  expect(slot.textContent).not.toContain("正在確認清單與觀看狀態");
});

it.each(["watchlist-map", "watch-status"])("retains previous data and a failed %s refresh after a successful append", async (endpoint) => {
  let failing = false;
  installFetch([[item(31)], [item(32)]], (call) => {
    const old = call.body.ids?.includes(31) || call.body.movieIds?.includes(31);
    if (old && failing && call.url.endsWith(endpoint)) return new Response(null, { status: 503 });
    if (call.url.endsWith("watchlist-map")) return Response.json({ activeIds: old ? [31] : [] });
    return Response.json({ statusMap: old ? { "movie:series:31": "completed" } : {} });
  });
  await search(`pagination-failure-${endpoint}`);
  await clickText("取消");
  failing = true;
  await open();
  await clickText("載入更多");
  expect(slot.textContent).toContain(endpoint === "watchlist-map" ? "清單狀態讀取失敗" : "觀看狀態讀取失敗");
  expect(star(31).getAttribute("aria-label")).toBe("移除清單");
  expect(slot.textContent).toContain("已看完");
  expect(star(32).getAttribute("aria-label")).toBe("加入清單");
});

it("refreshes every loaded result in bounded chunks on reopen, retry and status events", async () => {
  let failing = false;
  const pages = [0, 1, 2].map((page) => Array.from({ length: 20 }, (_, index) => item(100 + page * 20 + index)));
  installFetch(pages, (call) => failing && call.url.endsWith("watch-status") ? new Response(null, { status: 503 }) : undefined);
  await search("pagination-bounded-refresh");
  await clickText("載入更多");
  await clickText("載入更多");
  await clickText("取消");
  calls.length = 0;
  failing = true;
  await open();
  expect(mapCalls().map((call) => call.body.ids!.length)).toEqual([50, 10]);
  expect(statusCalls().map((call) => statusIds(call).length)).toEqual([50, 10]);
  expect(slot.textContent).toContain("觀看狀態讀取失敗");
  calls.length = 0;
  failing = false;
  await clickText("重試");
  expect(mapCalls().flatMap((call) => call.body.ids!)).toEqual(pages.flat().map((result) => result.id));
  expect(statusCalls().map((call) => statusIds(call).length)).toEqual([50, 10]);
  calls.length = 0;
  await act(async () => window.dispatchEvent(new Event(WATCH_STATUS_REFRESH_EVENT)));
  expect(mapCalls()).toHaveLength(0);
  expect(statusCalls().flatMap(statusIds)).toEqual(pages.flat().map((result) => result.id));
  expect(statusCalls().map((call) => statusIds(call).length)).toEqual([50, 10]);
});

it("ignores an earlier generation after reopening starts a fresh private read", async () => {
  const oldMap = deferred();
  const oldStatus = deferred();
  let initial = true;
  installFetch([[item(41)]], (call) => {
    if (initial) return call.url.endsWith("watchlist-map") ? oldMap.promise : oldStatus.promise;
  });
  await search("pagination-stale-reopen");
  await clickText("取消");
  initial = false;
  await open();
  await act(async () => {
    oldMap.resolve(Response.json({ activeIds: [41] }));
    oldStatus.resolve(Response.json({ statusMap: { "movie:series:41": "completed" } }));
  });
  expect(star(41).getAttribute("aria-label")).toBe("加入清單");
  expect(slot.textContent).not.toContain("已看完");
});