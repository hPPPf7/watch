// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: { session: { user: { id: "detail-race" } }, loading: false }, profiles: {} }));
vi.mock("@/hooks/useAuth", () => ({ default: () => mocks.auth }));
vi.mock("@/hooks/useProfileNames", () => ({ default: () => mocks.profiles }));
vi.mock("@/hooks/usePageActivityState", () => ({ default: () => false }));
vi.mock("@/hooks/useWatchRealtimeRefresh", () => ({ default: () => {} }));
vi.mock("next/image", () => ({ default: () => null }));
import DetailModal from "./DetailModal";
import { setDetailCache } from "@/lib/tmdbDetailCache";
const id = 99421; const otherId = 99422; const collectionId = 99942;
let sequence = 0; let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
const render = () => act(async () => root.render(<DetailModal open mediaType="movie" tmdbId={id} onClose={() => {}} />));
const revalidate = async () => { mocks.auth = { ...mocks.auth, session: { user: { ...mocks.auth.session.user } } }; await render(); };
const clickText = (text: string) => act(async () => [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === text)!.click());
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  Element.prototype.scrollIntoView = vi.fn();
  mocks.auth = { session: { user: { id: `detail-race-${sequence++}` } }, loading: false };
  setDetailCache(`movie:${id}`, { id, media_type: "movie", is_anime: false, title: "目前電影", release_date: "2020-01-01", countries: [], languages: [], collection_id: collectionId, collection_name: "測試系列" });
  setDetailCache(`collection:${collectionId}`, [{ id: otherId, title: "系列另一部", year: "2020", poster_path: null }]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); globalThis.IS_REACT_ACT_ENVIRONMENT = false; });
it.each([true, false])("bootstrap finishing before mutation=%s cannot unlock or overwrite a pending star", async bootstrapFirst => {
  let bootstrapCalls = 0; let writes = 0;
  let resolveBootstrap!: (response: Response) => void; let resolveMutation!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/bootstrap")) {
      bootstrapCalls += 1;
      if (bootstrapCalls > 1) return new Promise<Response>(resolve => { resolveBootstrap = resolve; });
      return Response.json({ inWatchlist: true, friends: [] });
    }
    if (url.endsWith("/watchlist-delete")) { writes += 1; return new Promise<Response>(resolve => { resolveMutation = resolve; }); }
    return Response.json({ ok: true, rows: [], count: 0 });
  }));
  await render();
  const star = host.querySelector<HTMLButtonElement>('button[aria-label="移除清單"]')!;
  await act(async () => { star.click(); star.click(); }); expect(writes).toBe(1);
  await revalidate();
  if (bootstrapFirst) {
    await act(async () => resolveBootstrap(Response.json({ inWatchlist: true, friends: [] })));
    expect(star.disabled).toBe(true);
    await act(async () => star.click()); expect(writes).toBe(1);
  }
  await act(async () => resolveMutation(Response.json({ ok: true })));
  if (!bootstrapFirst) await act(async () => resolveBootstrap(Response.json({ inWatchlist: true, friends: [] })));
  expect(star.getAttribute("aria-pressed")).toBe("false"); expect(star.disabled).toBe(false);
});
it("collection failures retain successes, keep unknown stars disabled and reject stale reads after a mutation", async () => {
  let mode: "failed" | "ready" | "pending" = "failed"; let writes = 0;
  let resolveMap!: (response: Response) => void; let resolveMutation!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/bootstrap")) return Response.json({ inWatchlist: true, friends: [] });
    if (url.endsWith("/watchlist-map")) {
      if (mode === "failed") throw new TypeError("offline");
      if (mode === "pending") return new Promise<Response>(resolve => { resolveMap = resolve; });
      return Response.json({ ids: [otherId] });
    }
    if (url.endsWith("/watchlist-delete")) { writes += 1; return new Promise<Response>(resolve => { resolveMutation = resolve; }); }
    return Response.json({ ok: true, rows: [], count: 0 });
  }));
  await render(); await clickText("查看系列電影");
  const unknown = host.querySelector<HTMLButtonElement>('button[aria-label="清單狀態待確認"]')!;
  expect(unknown.disabled).toBe(true); expect(unknown.hasAttribute("aria-pressed")).toBe(false);
  expect(host.textContent).toContain("系列清單狀態讀取失敗");
  const retry = () => act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="重試系列清單狀態"]')!.click());
  mode = "ready"; await retry(); expect(unknown.getAttribute("aria-pressed")).toBe("true");
  mode = "failed"; await revalidate(); expect(unknown.getAttribute("aria-pressed")).toBe("true");
  expect(host.textContent).toContain("系列清單狀態讀取失敗");
  mode = "pending"; await retry();
  await act(async () => { unknown.click(); unknown.click(); }); expect(writes).toBe(1); expect(unknown.disabled).toBe(true);
  await act(async () => resolveMutation(Response.json({ ok: true })));
  expect(unknown.getAttribute("aria-pressed")).toBe("false");
  await act(async () => resolveMap(Response.json({ ids: [otherId] })));
  expect(unknown.getAttribute("aria-pressed")).toBe("false"); expect(unknown.disabled).toBe(false);
});
