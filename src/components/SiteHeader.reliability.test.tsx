// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: { session: { user: { id: "header-user" } }, loading: false } }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/movies" }));
vi.mock("next/link", () => ({ default: ({ children, href }: ComponentProps<"a">) => <a href={href}>{children}</a> }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/hooks/useAuth", () => ({ default: () => mocks.auth }));
vi.mock("@/hooks/usePageActivityState", () => ({ default: () => false }));
vi.mock("@/hooks/useWatchRealtimeRefresh", () => ({ default: () => {} }));
vi.mock("@/features/site-header/usePendingFriendCount", () => ({ default: () => 0 }));
vi.mock("@/components/DetailModal", () => ({ default: ({ onClose }: { onClose: () => void }) => <div role="dialog"><button onClick={onClose}>關閉詳情</button></div> }));
import SiteHeader from "./SiteHeader";
let host: HTMLDivElement; let slot: HTMLDivElement; let root: ReturnType<typeof createRoot>;
const movie = { id: 8, media_type: "movie", title: "測試電影", year: "2026", release_date: null, is_anime: false, poster_path: null };
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers();
  host = document.createElement("div"); slot = document.createElement("div"); slot.id = "search-results-slot"; document.body.append(host, slot); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); slot.remove(); delete document.body.dataset.searchOpen; vi.useRealTimers(); vi.unstubAllGlobals(); globalThis.IS_REACT_ACT_ENVIRONMENT = false; });
const tick = () => act(async () => vi.advanceTimersByTimeAsync(450));
const clickText = (text: string) => act(async () => { [...document.querySelectorAll("button")].find(button => button.textContent?.trim() === text)!.click(); });
const open = () => act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="搜尋"]')!.click());
const query = async (value: string) => {
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await tick();
};
it("recovers unknown private stars, exposes separate search controls and preserves results on cancel", async () => {
  let failing = true;
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes("/tmdb/search")) return Response.json({ results: [movie] });
    if (url.endsWith("watchlist-map")) return failing ? new Response(null, { status: 503 }) : Response.json({ activeIds: [8] });
    if (url.endsWith("watch-status")) return Response.json({ statusMap: { "movie:series:8": "completed" } });
    return Response.json({ avatarUrl: null });
  });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<SiteHeader />));
  await open(); await query("cancel-query");
  expect(host.querySelector("button input")).toBeNull();
  expect(slot.querySelector('button[aria-label="清單狀態待確認"]')).not.toBeNull();
  expect(slot.textContent).toContain("清單狀態讀取失敗");
  failing = false; await clickText("重試");
  expect(slot.querySelector('button[aria-label="移除清單"]')).not.toBeNull();
  await act(async () => slot.querySelector<HTMLButtonElement>('button[aria-label="查看 測試電影 詳情"]')!.click());
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(host.querySelector("input")).not.toBeNull();
  await clickText("關閉詳情");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true })));
  expect(host.querySelector("input")).not.toBeNull();
  await clickText("取消");
  expect(host.querySelector("input")).toBeNull(); expect(slot.textContent).toBe("");
  expect(document.body.dataset.searchOpen).toBeUndefined();
  await open(); await tick();
  expect(host.querySelector("input")!.value).toBe("cancel-query");
  expect(slot.textContent).toContain("測試電影");
  expect(fetcher.mock.calls.filter(([url]) => url.includes("/tmdb/search"))).toHaveLength(1);
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(host.querySelector("input")).toBeNull();
  expect(document.activeElement).toBe(host.querySelector('button[aria-label="搜尋"]'));
});
it("retains badges on failed refresh and prevents stale maps from overwriting a guarded mutation", async () => {
  let mode: "ready" | "failed" | "pending" = "ready";
  let resolveMap!: (response: Response) => void; let resolveMutation!: (response: Response) => void;
  let writes = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/tmdb/search")) return Response.json({ results: [movie] });
    if (url.endsWith("watchlist-toggle")) { writes += 1; return new Promise<Response>(resolve => { resolveMutation = resolve; }); }
    if (url.endsWith("watchlist-map")) {
      if (mode === "failed") throw new TypeError("offline");
      if (mode === "pending") return new Promise<Response>(resolve => { resolveMap = resolve; });
      return Response.json({ activeIds: [8] });
    }
    if (url.endsWith("watch-status")) return mode === "failed" ? new Response(null, { status: 503 }) : Response.json({ statusMap: { "movie:series:8": "completed" } });
    return Response.json({ avatarUrl: null });
  }));
  await act(async () => root.render(<SiteHeader />));
  await open(); await query("pending-query");
  await clickText("取消"); mode = "failed"; await open(); await tick();
  expect(slot.textContent).toContain("讀取失敗"); expect(slot.textContent).toContain("已看完");
  expect(slot.querySelector('button[aria-label="移除清單"]')).not.toBeNull();
  mode = "pending"; await clickText("重試");
  const star = slot.querySelector<HTMLButtonElement>('button[aria-label="移除清單"]')!;
  await act(async () => { star.click(); star.click(); });
  expect(writes).toBe(1); expect(star.disabled).toBe(true);
  await act(async () => resolveMutation(Response.json({ ok: true })));
  expect(star.getAttribute("aria-pressed")).toBe("false");
  await act(async () => resolveMap(Response.json({ activeIds: [8] })));
  expect(star.getAttribute("aria-pressed")).toBe("false"); expect(star.disabled).toBe(false);
});
it("retries failed public search with its existing query", async () => {
  let failing = true;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/tmdb/search")) return failing ? new Response(null, { status: 503 }) : Response.json({ results: [movie] });
    return Response.json(url.endsWith("watch-status") ? { statusMap: {} } : { activeIds: [] });
  }));
  await act(async () => root.render(<SiteHeader />)); await open(); await query("retry-query");
  expect(slot.textContent).toContain("搜尋失敗");
  failing = false; await clickText("重試"); await tick();
  expect(host.querySelector("input")!.value).toBe("retry-query"); expect(slot.textContent).toContain("測試電影");
});
it("honors Retry-After when a user manually retries search", async () => {
  let searches = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/tmdb/search")) {
      searches += 1;
      return searches === 1 ? new Response(null, { status: 429, headers: { "Retry-After": "60" } }) : Response.json({ results: [] });
    }
    return Response.json({ avatarUrl: null });
  }));
  await act(async () => root.render(<SiteHeader />)); await open(); await query("cooldown-query");
  await clickText("重試"); await tick(); expect(searches).toBe(1);
  await act(async () => vi.advanceTimersByTimeAsync(61_000));
  await clickText("重試"); await tick(); expect(searches).toBe(2);
});
