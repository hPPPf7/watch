// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import useMediaSearch, { type SearchResult } from "./useMediaSearch";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let search: ReturnType<typeof useMediaSearch>;
const movie = (id: number): SearchResult => ({ id, media_type: "movie", title: "作品 " + id, year: "2026", release_date: "2026-01-01", is_anime: false, poster_path: null });
const payload = (ids: number[], page = 1, total_pages = 3) => Response.json({ results: ids.map(movie), page, total_pages });
function Harness({ query, enabled, composing }: { query: string; enabled: boolean; composing: boolean }) {
  const value = useMediaSearch(query, enabled, composing);
  useLayoutEffect(() => { search = value; }, [value]);
  return <div>{value.results.map(item => item.title).join(",")}</div>;
}
const render = (query: string, enabled = true, composing = false) => act(async () => root.render(<Harness query={query} enabled={enabled} composing={composing} />));
const tick = (ms = 450) => act(async () => vi.advanceTimersByTimeAsync(ms));
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

it("waits for IME commit and debounces the completed query", async () => {
  const fetcher = vi.fn<(url: string) => Promise<Response>>(async () => payload([1])); vi.stubGlobal("fetch", fetcher);
  await render("注音組字測試", true, true); await tick(2000);
  expect(fetcher).not.toHaveBeenCalled();
  await render("注音完成測試", true, false); await tick(200);
  expect(fetcher).not.toHaveBeenCalled(); await tick(250);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(decodeURIComponent(fetcher.mock.calls[0][0])).toContain("注音完成測試");
  expect(search.results.map(item => item.id)).toEqual([1]);
});

it("deduplicates rapid next-page clicks and results, keeps loaded cards after failure, and retries the same page", async () => {
  let resolveNext!: (response: Response) => void;
  let nextAttempts = 0;
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith("page=1")) return payload([1, 1, 2]);
    nextAttempts += 1;
    return nextAttempts === 1 ? new Promise<Response>(resolve => { resolveNext = resolve; }) : payload([2, 3], 2);
  });
  vi.stubGlobal("fetch", fetcher); await render("pagination-retry"); await tick();
  expect(search.results.map(item => item.id)).toEqual([1, 2]);
  await act(async () => { void search.loadMore(); void search.loadMore(); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => resolveNext(new Response(null, { status: 503 })));
  expect(search.results.map(item => item.id)).toEqual([1, 2]); expect(search.moreError).toContain("保留");
  await act(async () => { await search.loadMore(); });
  expect(search.results.map(item => item.id)).toEqual([1, 2, 3]);
  expect(fetcher.mock.calls.slice(1).every(([url]) => url.endsWith("page=2"))).toBe(true);
});

it("ignores a previous query's late next page, even if the transport ignores abort", async () => {
  let resolveOld!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("race-old") && url.endsWith("page=2")) return new Promise<Response>(resolve => { resolveOld = resolve; });
    return payload([url.includes("race-new") ? 8 : 1]);
  }));
  await render("race-old"); await tick(); await act(async () => { void search.loadMore(); });
  await render("race-new"); expect(search.results).toEqual([]); await tick();
  await act(async () => resolveOld(payload([2], 2)));
  expect(search.results.map(item => item.id)).toEqual([8]); expect(search.loadingMore).toBe(false);
});

it("retains loaded pages when reopening, but does not extend their lifetime on append", async () => {
  const fetcher = vi.fn(async (url: string) => url.endsWith("page=2") ? payload([2], 2) : payload([1]));
  vi.stubGlobal("fetch", fetcher);
  await render("fixed-expiry"); await tick(); await tick(9 * 60_000);
  await act(async () => { await search.loadMore(); });
  await render("fixed-expiry", false); await render("fixed-expiry"); await tick();
  expect(search.results.map(item => item.id)).toEqual([1, 2]); expect(fetcher).toHaveBeenCalledTimes(2);
  await tick(61_000); await render("fixed-expiry", false); await render("fixed-expiry"); await tick();
  expect(fetcher).toHaveBeenCalledTimes(3); expect(search.results.map(item => item.id)).toEqual([1]);
});

it("keeps pagination available for an empty movie/TV page and rejects malformed next pages", async () => {
  let malformed = true;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("page=1") ? payload([]) : malformed
    ? Response.json({ results: [], page: 99, total_pages: 3 }) : payload([4], 2)));
  await render("people-page"); await tick(); expect(search.hasMore).toBe(true);
  await act(async () => { await search.loadMore(); }); expect(search.moreError).not.toBe("");
  malformed = false; await act(async () => { await search.loadMore(); });
  expect(search.results.map(item => item.id)).toEqual([4]);
});
