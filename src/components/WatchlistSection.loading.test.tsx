// @vitest-environment jsdom
import { act, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ session: { user: { id: "loading-user" } }, loading: false }));
vi.mock("@/hooks/useAuth", () => ({ default: () => auth }));
vi.mock("@/hooks/useProfileNames", () => ({ default: () => ({}) }));
vi.mock("@/hooks/usePageActivityState", () => ({ default: () => false }));
vi.mock("@/components/DetailModal", () => ({
  default: ({ tmdbId, mediaType, onWatchlistChange }: {
    tmdbId: number;
    mediaType: "movie" | "tv";
    onWatchlistChange: (active: boolean, detail: { id: number; media_type: "movie" | "tv"; is_anime: boolean }) => void;
  }) => <button data-remove onClick={() => onWatchlistChange(false, { id: tmdbId, media_type: mediaType, is_anime: false })}>模擬已成功移除</button>,
}));
vi.mock("@/components/WatchlistCard", () => ({
  default: ({ title, onClick }: { title: string; onClick: () => void }) => <button data-card onClick={onClick}>{title}</button>,
}));

import WatchlistSection from "./WatchlistSection";

const categories = [
  { category: "movie", mediaType: "movie" as const, isAnime: false },
  { category: "tv", mediaType: "tv" as const, isAnime: false },
  { category: "anime", mediaType: "tv" as const, isAnime: true },
];
const cases = categories.flatMap(category => [false, true].map(cached => ({ ...category, cached })));
const emptyText = "目前尚未加入任何內容。";
type Case = typeof cases[number];
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let commits: string[];
let countChanges: ReturnType<typeof vi.fn<(count: number | null) => void>>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  localStorage.clear();
  sessionStorage.clear();
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 loading-test");
  host = document.createElement("div");
  root = createRoot(host);
  commits = [];
  countChanges = vi.fn<(count: number | null) => void>();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

function seedSnapshot(testCase: Case, items: ReturnType<typeof rowFor>[] = []) {
  if (!testCase.cached) return;
  if (items.length > 0) {
    localStorage.setItem(`watchlist:had-data:loading-user:${testCase.mediaType}:${testCase.isAnime}`, "1");
  }
  localStorage.setItem(`watchlist:section:v2:loading-user:${testCase.mediaType}:${testCase.isAnime}`, JSON.stringify({
    storedAt: Date.now(), tmdbExpiresAt: Date.now() + 60_000, revision: "r1", items,
    watchedDateMap: {}, watchedCountMap: {}, watchedFriendIdsMap: {}, sharedOwnerIdMap: {},
    friendFallbackMap: {}, latestEpisodeMap: {}, watchedEpisodeCountMap: {},
    watchedCreatedAtMap: {}, latestWatchedDateMap: {}, latestWatchedCreatedAtMap: {},
    tvStateMap: {}, newEpisodeAlertMap: {}, episodeStatusMap: {}, episodeProgressMap: {},
  }));
}

async function mountPending(testCase: Case, cachedItems: ReturnType<typeof rowFor>[] = []) {
  seedSnapshot(testCase, cachedItems);
  const sectionResponses: Array<(response: Response) => void> = [];
  const settle = (response: Response) => {
    for (const resolve of sectionResponses.splice(0)) resolve(response.clone());
  };
  let settleHasData!: (response: Response) => void;
  const hasDataResponse = new Promise<Response>(resolve => { settleHasData = resolve; });
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.includes("/section-data")) return new Promise<Response>(resolve => { sectionResponses.push(resolve); });
    if (url.includes("/has-data")) return (await hasDataResponse).clone();
    if (url.includes("/revision")) return Response.json({ revision: "r1" });
    if (url.includes("/tv-states/upsert")) {
      const body = JSON.parse(String(init?.body));
      return Response.json({ persistedStates: Object.fromEntries(body.states.map((state: { tmdb_id: number }) => [state.tmdb_id, state])) });
    }
    throw new Error(`Unexpected mocked request: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(
    <Profiler id="watchlist-loading" onRender={() => { commits.push(host.textContent ?? ""); }}>
      <WatchlistSection title="清單" mediaType={testCase.mediaType} isAnime={testCase.isAnime} filter="all" onCountChange={countChanges} />
    </Profiler>,
  ));
  // Exceed the real card-readiness delay while section-data and has-data remain pending.
  await advance(100);
  return { settle, settleHasData, fetcher, sectionReads: () => fetcher.mock.calls.filter(([url]) => String(url).includes("/section-data")).length };
}

const rowFor = (testCase: Case) => ({
  id: "server-row", tmdb_id: 990321, title: `伺服器的${testCase.category}作品`,
  year: "2020", release_date: "2020-01-01", status: testCase.mediaType === "movie" ? "Released" : "Ended",
  tmdb_cached_at: new Date().toISOString(), poster_path: "/test.jpg",
  media_type: testCase.mediaType, is_anime: testCase.isAnime, created_at: "2020-01-01",
});
const successfulPayload = (rows: ReturnType<typeof rowFor>[]) => ({
  rows, movieHistoryRows: [], latestEpisodes: {}, watchedCounts: {}, tvStateRows: [],
  friends: [], revision: "r1",
});
const advance = (milliseconds: number) => act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
const waitForCards = () => advance(100);

it.each(cases)("does not commit an empty message before delayed $category rows arrive (cached=$cached)", async testCase => {
  const { settle, sectionReads } = await mountPending(testCase);
  const pendingReadCount = sectionReads();
  expect(pendingReadCount).toBeGreaterThan(0);
  expect(commits.filter(text => text.includes(emptyText))).toEqual([]);
  expect(host.querySelector('[role="status"]')?.textContent).toContain("載入中");
  expect(countChanges.mock.calls.flat()).not.toContain(0);

  const row = rowFor(testCase);
  await act(async () => settle(Response.json(successfulPayload([row]))));
  await waitForCards();
  expect(host.querySelector("[data-card]")?.textContent).toBe(row.title);
  expect(commits.filter(text => text.includes(emptyText))).toEqual([]);
  expect(countChanges).toHaveBeenLastCalledWith(1);
  expect(sectionReads()).toBe(pendingReadCount);
});

it.each(cases)("shows a genuinely empty $category list only after a successful read (cached=$cached)", async testCase => {
  const { settle, sectionReads } = await mountPending(testCase);
  const pendingReadCount = sectionReads();
  expect(commits.filter(text => text.includes(emptyText))).toEqual([]);
  expect(countChanges.mock.calls.flat()).not.toContain(0);

  await act(async () => settle(Response.json(successfulPayload([]))));
  await waitForCards();
  expect(commits.filter(text => text.includes(emptyText))).toEqual([]);
  expect(host.querySelector('[role="status"]')?.textContent).toContain("載入中");
  expect(countChanges.mock.calls.flat()).not.toContain(0);
  await advance(1200);
  expect(sectionReads()).toBe(pendingReadCount + 1);
  expect(commits.filter(text => text.includes(emptyText))).toEqual([]);

  await act(async () => settle(Response.json(successfulPayload([]))));
  await waitForCards();
  expect(host.textContent).toContain(emptyText);
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(countChanges).toHaveBeenLastCalledWith(0);
  await advance(5000);
  expect(sectionReads()).toBe(pendingReadCount + 1);
});

it.each(cases)("shows a first-read failure rather than an empty $category list (cached=$cached)", async testCase => {
  const { settle, sectionReads } = await mountPending(testCase);
  const pendingReadCount = sectionReads();
  expect(commits.filter(text => text.includes(emptyText))).toEqual([]);

  await act(async () => settle(new Response(null, { status: 503 })));
  await waitForCards();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("同步失敗");
  expect([...host.querySelectorAll("button")].some(button => button.textContent === "重試" && !button.disabled)).toBe(true);
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(countChanges.mock.calls.flat()).not.toContain(0);
  expect(commits.filter(text => text.includes(emptyText))).toEqual([]);
  expect(sectionReads()).toBe(pendingReadCount);
});

it.each(cases)("keeps the empty state hidden during manual retry after a failed $category read (cached=$cached)", async testCase => {
  const { settle, sectionReads } = await mountPending(testCase);
  await act(async () => settle(new Response(null, { status: 503 })));
  await waitForCards();
  const readsBeforeRetry = sectionReads();
  const retry = [...host.querySelectorAll("button")].find(button => button.textContent === "重試")!;
  expect(retry.disabled).toBe(false);
  await act(async () => retry.click());
  await waitForCards();
  expect(sectionReads()).toBe(readsBeforeRetry + 1);
  expect(commits.filter(text => text.includes(emptyText))).toEqual([]);
  expect(countChanges.mock.calls.flat()).not.toContain(0);
  expect(host.querySelector('[role="status"]')?.textContent).toContain("載入中");

  const row = rowFor(testCase);
  await act(async () => settle(Response.json(successfulPayload([row]))));
  await waitForCards();
  expect(host.querySelector("[data-card]")?.textContent).toBe(row.title);
  expect(commits.filter(text => text.includes(emptyText))).toEqual([]);
  expect(countChanges).toHaveBeenLastCalledWith(1);
  await advance(5000);
  expect(sectionReads()).toBe(readsBeforeRetry + 1);
});

it.each([
  { label: "missing rows", payload: { revision: "r1" } },
  { label: "malformed rows", payload: { rows: {}, revision: "r1" } },
])("does not interpret $label as a successful empty list", async ({ payload }) => {
  const { settle } = await mountPending({ ...categories[0], cached: true });
  await act(async () => settle(Response.json(payload)));
  await waitForCards();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("同步失敗");
  expect(commits.filter(text => text.includes(emptyText))).toEqual([]);
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(countChanges.mock.calls.flat()).not.toContain(0);
});

it.each(categories)("retains nonempty cached $category cards while refreshing and after a failed read", async category => {
  const testCase = { ...category, cached: true };
  const row = rowFor(testCase);
  const { settle, sectionReads } = await mountPending(testCase, [row]);
  const pendingReadCount = sectionReads();
  expect(host.querySelector("[data-card]")?.textContent).toBe(row.title);
  expect(countChanges).toHaveBeenLastCalledWith(1);
  expect(commits.filter(text => text.includes(emptyText))).toEqual([]);

  await act(async () => settle(new Response(null, { status: 503 })));
  await waitForCards();
  expect(host.querySelector("[data-card]")?.textContent).toBe(row.title);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("同步失敗");
  expect(commits.filter(text => text.includes(emptyText))).toEqual([]);
  expect(sectionReads()).toBe(pendingReadCount);

  const retry = [...host.querySelectorAll("button")].find(button => button.textContent === "重試")!;
  await act(async () => retry.click());
  await waitForCards();
  expect(host.querySelector("[data-card]")?.textContent).toBe(row.title);
  expect(commits.filter(text => text.includes(emptyText))).toEqual([]);
  expect(sectionReads()).toBe(pendingReadCount + 1);
  await act(async () => settle(Response.json(successfulPayload([row]))));
  await waitForCards();
  expect(host.querySelector("[data-card]")?.textContent).toBe(row.title);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await advance(5000);
  expect(sectionReads()).toBe(pendingReadCount + 1);
});

it.each([
  ...categories.map(category => ({ ...category, desktop: false })),
  { ...categories[0], desktop: true },
])("keeps cached $category cards through one contradictory empty retry and then shows an error (desktop=$desktop)", async category => {
  if (category.desktop) vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Electron loading-test");
  const testCase = { ...category, cached: true };
  const row = rowFor(testCase);
  const readCachedItems = () => JSON.parse(localStorage.getItem(
    `watchlist:section:v2:loading-user:${testCase.mediaType}:${testCase.isAnime}`,
  )!).items;
  const { settle, settleHasData, sectionReads } = await mountPending(testCase, [row]);
  await act(async () => settleHasData(Response.json({ hasSectionData: true })));
  const pendingReadCount = sectionReads();
  await act(async () => settle(Response.json(successfulPayload([]))));
  await waitForCards();
  expect(host.querySelector("[data-card]")?.textContent).toBe(row.title);
  expect(readCachedItems()).toEqual([expect.objectContaining({ id: row.id })]);
  expect(commits.filter(text => text.includes(emptyText))).toEqual([]);
  await advance(200);
  expect(sectionReads()).toBe(pendingReadCount + 1);

  await act(async () => settle(Response.json(successfulPayload([]))));
  await waitForCards();
  expect(host.querySelector("[data-card]")?.textContent).toBe(row.title);
  expect(readCachedItems()).toEqual([expect.objectContaining({ id: row.id })]);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("資料暫時無法確認");
  if (category.desktop) {
    expect(host.textContent).toContain("同步失敗，稍後重試");
    expect(host.textContent).not.toContain("正在同步…");
    expect(host.querySelector(".watch-spinner")).toBeNull();
  }
  expect([...host.querySelectorAll("button")].some(button => button.textContent === "重試" && !button.disabled)).toBe(true);
  expect(commits.filter(text => text.includes(emptyText))).toEqual([]);
  await advance(5000);
  expect(sectionReads()).toBe(pendingReadCount + 1);
});

it("accepts an empty response after the user has successfully removed the last cached movie", async () => {
  const testCase = { ...categories[0], cached: true };
  const row = rowFor(testCase);
  const { settle, settleHasData, sectionReads } = await mountPending(testCase, [row]);
  await act(async () => settleHasData(Response.json({ hasSectionData: true })));
  await act(async () => settle(Response.json(successfulPayload([row]))));
  await waitForCards();
  expect(host.querySelector("[data-card]")?.textContent).toBe(row.title);
  await act(async () => host.querySelector<HTMLButtonElement>("[data-card]")!.click());
  await act(async () => host.querySelector<HTMLButtonElement>("[data-remove]")!.click());
  const readCountAfterRemoval = sectionReads();
  await act(async () => settle(Response.json(successfulPayload([]))));
  await waitForCards();
  expect(host.querySelector("[data-card]")).toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain(emptyText);
  expect(countChanges).toHaveBeenLastCalledWith(0);
  await advance(5000);
  expect(sectionReads()).toBe(readCountAfterRemoval);
});
