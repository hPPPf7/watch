// @vitest-environment jsdom
import { act, useLayoutEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ session: { user: { id: "home-user" } }, loading: false }));
vi.mock("@/hooks/useAuth", () => ({ default: () => auth }));
vi.mock("@/hooks/usePageActivityState", () => ({ default: () => false }));
vi.mock("@/hooks/useWatchRealtimeRefresh", () => ({ default: () => {} }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/components/SiteFooter", () => ({ default: () => null }));
vi.mock("@/components/DetailModal", () => ({ default: () => null }));
vi.mock("@/components/SiteHeader", () => ({ default: ({ onHomeCategoryChange }: { onHomeCategoryChange: (type: "movie" | "tv" | "anime") => void }) => <><button onClick={() => onHomeCategoryChange("movie")}>movies</button><button onClick={() => onHomeCategoryChange("tv")}>tv</button><button onClick={() => onHomeCategoryChange("anime")}>anime</button></> }));
vi.mock("@/components/HomeCarousel", () => ({
  default: function MockHomeCarousel({ itemCount, renderItem }: {
    itemCount: number;
    renderItem: (index: number, copy: number) => ReactNode;
  }) {
    // Observe the committed UI before Home's passive effects can hide a warning.
    useLayoutEffect(() => {
      carouselCommits.push({
        alerts: [...host.querySelectorAll('[role="alert"]')].map(alert => alert.textContent),
        status: host.querySelector('[role="status"]')?.textContent ?? null,
        unknownStars: host.querySelectorAll('button[aria-label="清單狀態待確認"]').length,
      });
    });
    return <div>{Array.from({ length: itemCount }, (_, index) => <div key={index}>{renderItem(index, 0)}</div>)}</div>;
  },
}));
import Home from "./page";
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
let carouselCommits: { alerts: (string | null)[]; status: string | null; unknownStars: number }[];
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); carouselCommits = []; host = document.createElement("div"); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); localStorage.clear(); globalThis.IS_REACT_ACT_ENVIRONMENT = false; });
const click = (text: string) => act(async () => { [...host.querySelectorAll("button")].find(button => button.textContent === text)!.click(); });
const recommendations = () => Response.json({ lists: [{ key: "one", title: "推薦一", data: [{ id: 1, title: "電影一", name: "影集一" }] }, { key: "two", title: "推薦二", data: [{ id: 1, title: "電影一", name: "影集一" }] }] });
const deferredResponse = () => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(settle => { resolve = settle; });
  return { promise, resolve };
};
it("shows loading without even a committed warning while initial private status is pending", async () => {
  const publicResponse = deferredResponse();
  const mapResponse = deferredResponse();
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith("recommendations")) return publicResponse.promise;
    if (url.endsWith("watch-status")) return Response.json({ statusMap: {} });
    return mapResponse.promise;
  });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<Home />));
  expect(host.querySelector('[role="status"]')?.textContent).toBe("正在載入推薦作品…");
  expect(host.querySelector('[role="alert"]')).toBeNull();

  await act(async () => publicResponse.resolve(recommendations()));
  const unknownStars = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label="清單狀態待確認"]')];
  expect(unknownStars).toHaveLength(2);
  expect(unknownStars.every(star => star.disabled)).toBe(true);
  expect(host.querySelector('[role="status"]')?.textContent).toBe("正在確認清單與觀看狀態…");
  expect(host.querySelector('[role="status"] .watch-spinner')).not.toBeNull();
  const pendingCommits = carouselCommits.filter(commit => commit.unknownStars > 0);
  expect(pendingCommits.length).toBeGreaterThan(0);
  expect(pendingCommits.every(commit => commit.alerts.length === 0 && commit.status !== null)).toBe(true);

  await act(async () => mapResponse.resolve(Response.json({ activeIds: [1] })));
  expect(host.querySelectorAll('button[aria-label="移除清單"]')).toHaveLength(2);
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.querySelector(".watch-spinner")).toBeNull();
  expect(carouselCommits.flatMap(commit => commit.alerts)).toEqual([]);
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith("watchlist-map"))).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith("recommendations"))).toHaveLength(1);
});

it("keeps newly selected categories in loading until their own private response succeeds", async () => {
  const tvResponse = deferredResponse();
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("recommendations")) return recommendations();
    if (url.endsWith("watch-status")) return Response.json({ statusMap: {} });
    const body = JSON.parse(init!.body as string);
    return body.mediaType === "tv" ? tvResponse.promise : Response.json({ activeIds: [1] });
  });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<Home />));
  expect(host.querySelector('[role="status"]')).toBeNull();
  carouselCommits = [];
  await click("tv");
  expect(host.textContent).toContain("影集推薦");
  expect(host.querySelector('[role="status"]')?.textContent).toBe("正在確認清單與觀看狀態…");
  expect(host.querySelector('[role="status"] .watch-spinner')).not.toBeNull();
  expect(host.querySelectorAll('button[aria-label="清單狀態待確認"]')).toHaveLength(2);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  const pendingCommits = carouselCommits.filter(commit => commit.unknownStars > 0);
  expect(pendingCommits.length).toBeGreaterThan(0);
  expect(pendingCommits.every(commit => commit.alerts.length === 0 && commit.status !== null)).toBe(true);

  await act(async () => tvResponse.resolve(Response.json({ activeIds: [] })));
  expect(host.querySelectorAll('button[aria-label="加入清單"]')).toHaveLength(2);
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.querySelector(".watch-spinner")).toBeNull();
  expect(carouselCommits.flatMap(commit => commit.alerts)).toEqual([]);
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith("watchlist-map"))).toHaveLength(2);
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith("recommendations"))).toHaveLength(2);
});

it("shows initial unknown stars on private failure and recovers with the same category", async () => {
  let failed = true;
  const retryResponse = deferredResponse();
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith("recommendations")) return recommendations();
    if (url.endsWith("watch-status")) return Response.json({ statusMap: {} });
    return failed ? new Response(null, { status: 503 }) : retryResponse.promise;
  });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<Home />));
  expect(host.querySelectorAll('button[aria-label="清單狀態待確認"]')).toHaveLength(2);
  expect(host.textContent).toContain("清單狀態讀取失敗");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("清單狀態讀取失敗");
  expect(host.querySelector('[role="status"]')).toBeNull();
  failed = false;
  carouselCommits = [];
  await click("重試");
  expect(host.querySelector('[role="status"]')?.textContent).toBe("正在確認清單與觀看狀態…");
  expect(host.querySelector('[role="status"] .watch-spinner')).not.toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelectorAll('button[aria-label="清單狀態待確認"]:disabled')).toHaveLength(2);
  expect(carouselCommits.flatMap(commit => commit.alerts)).toEqual([]);
  await act(async () => retryResponse.resolve(Response.json({ activeIds: [1] })));
  expect(host.querySelectorAll('button[aria-label="移除清單"]')).toHaveLength(2);
  expect(host.textContent).not.toContain("讀取失敗");
  expect(host.textContent).toContain("電影推薦");
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.querySelector(".watch-spinner")).toBeNull();
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith("watchlist-map"))).toHaveLength(2);
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith("recommendations"))).toHaveLength(1);
});
it("retains active stars, locks duplicate cards, catches network errors and rejects stale maps", async () => {
  let mapCount = 0; let resolveMap!: (response: Response) => void;
  let rejectMutation!: (reason: Error) => void;
  let resolveMutation!: (response: Response) => void;
  let mutationCount = 0;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("recommendations")) return recommendations();
    if (url.endsWith("watch-status")) return Response.json({ statusMap: {} });
    if (url.endsWith("watchlist-toggle")) {
      mutationCount += 1;
      return new Promise<Response>((resolve, reject) => { resolveMutation = resolve; rejectMutation = reject; });
    }
    const body = JSON.parse(init!.body as string);
    if (body.mediaType === "tv") return Response.json({ activeIds: [] });
    mapCount += 1;
    if (mapCount === 2) return new Response(null, { status: 503 });
    if (mapCount === 3) return new Promise<Response>(resolve => { resolveMap = resolve; });
    return Response.json({ activeIds: [1] });
  });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<Home />));
  await click("tv"); await click("movies");
  expect(host.textContent).toContain("清單狀態讀取失敗");
  expect(host.querySelectorAll('button[aria-label="移除清單"]')).toHaveLength(2);
  await click("重試");
  let stars = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label="移除清單"]')];
  await act(async () => { stars[0].click(); stars[1].click(); });
  expect(mutationCount).toBe(1);
  expect(host.querySelectorAll('button[aria-busy="true"]')).toHaveLength(2);
  await act(async () => rejectMutation(new TypeError("offline")));
  expect(host.textContent).toContain("清單更新失敗");
  stars = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label="移除清單"]')];
  expect(stars[0].disabled).toBe(false);
  await act(async () => stars[0].click());
  await act(async () => resolveMutation(Response.json({ ok: true })));
  expect(host.querySelectorAll('button[aria-label="加入清單"]')).toHaveLength(2);
  await act(async () => resolveMap(Response.json({ activeIds: [1] })));
  expect(host.querySelectorAll('button[aria-label="加入清單"]')).toHaveLength(2);
});
it("retries public recommendations without changing category", async () => {
  let failed = true;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("recommendations")) return failed ? new Response(null, { status: 503 }) : recommendations();
    return Response.json(url.endsWith("watch-status") ? { statusMap: {} } : { activeIds: [] });
  }));
  await act(async () => root.render(<Home />));
  expect(host.textContent).toContain("目前無法取得資料");
  expect(host.querySelector("nav a")).toBeNull();
  failed = false; await click("重試");
  expect(host.textContent).toContain("電影一");
  expect(host.querySelectorAll("nav a")).toHaveLength(2);
  expect(host.textContent).toContain("電影推薦");
});

it("locks TV and anime aliases together and applies reclassification to both categories", async () => {
  let resolveMutation!: (response: Response) => void; let writes = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("recommendations")) return recommendations();
    if (url.endsWith("watch-status")) return Response.json({ statusMap: {} });
    if (url.endsWith("watchlist-toggle")) { writes += 1; return new Promise<Response>(resolve => { resolveMutation = resolve; }); }
    return Response.json({ activeIds: [] });
  }));
  await act(async () => root.render(<Home />)); await click("tv");
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="加入清單"]')!.click());
  await click("anime");
  const aliases = host.querySelectorAll<HTMLButtonElement>('button[aria-busy="true"]');
  expect(aliases).toHaveLength(2);
  await act(async () => aliases[0].click()); expect(writes).toBe(1);
  await act(async () => resolveMutation(Response.json({ ok: true, affectedIsAnime: [false, true] })));
  expect(host.querySelectorAll('button[aria-label="加入清單"]')).toHaveLength(2);
  expect(host.querySelector('button[aria-label="移除清單"]')).toBeNull();
});

it("links only to loaded category sections without fetching on shortcut activation", async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith("recommendations")) return recommendations();
    return Response.json(url.endsWith("watch-status") ? { statusMap: {} } : { activeIds: [] });
  });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<Home />));
  for (const [button, category] of [["movies", "movie"], ["tv", "tv"], ["anime", "anime"]] as const) {
    await click(button);
    const links = [...host.querySelectorAll<HTMLAnchorElement>("nav a")];
    expect(links).toHaveLength(2);
    const before = fetcher.mock.calls.length;
    for (const link of links) {
      const target = link.getAttribute("href")!;
      expect(target).toMatch(new RegExp("^#home-recommendations-" + category + "-"));
      expect(host.querySelector(target)?.getAttribute("tabindex")).toBe("-1");
      link.addEventListener("click", event => event.preventDefault(), { once: true });
      await act(async () => link.click());
    }
    expect(fetcher).toHaveBeenCalledTimes(before);
  }
});
