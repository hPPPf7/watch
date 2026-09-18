// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: { session: { user: { id: "editor-user" } }, loading: false },
  profiles: {},
}));
vi.mock("@/hooks/useAuth", () => ({ default: () => state.auth }));
vi.mock("@/hooks/useProfileNames", () => ({ default: () => state.profiles }));
vi.mock("@/hooks/usePageActivityState", () => ({ default: () => false }));
vi.mock("next/image", () => ({ default: () => null }));
import DetailModal from "./DetailModal";
import { setDetailCache } from "@/lib/tmdbDetailCache";
import { openWatchEventSource } from "@/lib/sharedWatchEventSource";

// Exercise the actual shared SSE + refresh hook, including the onopen replay
// when another consumer (such as the page header) keeps the connection alive.
class WatchEventSource {
  static instances: WatchEventSource[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  close = vi.fn();
  constructor() { WatchEventSource.instances.push(this); }
}
let headerSubscription: ReturnType<typeof openWatchEventSource>;
let holdHistoryRead: boolean;
let resolveHistoryRead: ((response: Response) => void) | null;
const emitUpdate = (at: number) => WatchEventSource.instances[0].onmessage!(new MessageEvent("message", {
  data: JSON.stringify({ type: "watchlist_update", reason: "history_upsert", at }),
}));

type MediaType = "movie" | "tv";
type SaveMode = "success" | "failure" | "friend-conflict" | "revision-conflict" | "pending";
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let sequence = 0;
let tmdbId: number;
let saveMode: SaveMode;
let sharedRecords: boolean;
let resolveSave: ((response: Response) => void) | null;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
let onClose: ReturnType<typeof vi.fn<() => void>>;
const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
const originalDate = "2020-02-02";
const otherDate = "2020-02-01";
const draftDate = "2020-02-05";

const render = (mediaType: MediaType, id = tmdbId, open = true) => act(async () => root.render(
  <DetailModal open={open} defaultTab="history" mediaType={mediaType} tmdbId={id} onClose={onClose} />,
));
const getDateInput = () => host.querySelector<HTMLInputElement>('input[type="date"]');
const getEditor = () => getDateInput()?.closest<HTMLElement>('[role="dialog"]') ?? null;
const buttonNamed = (label: string, container: ParentNode = host) => {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find(item => item.textContent?.trim() === label);
  expect(button, `找不到按鈕 ${label}`).toBeDefined();
  return button!;
};
const edit = (index = 0) => act(async () => {
  const buttons = host.querySelectorAll<HTMLButtonElement>('button[aria-label="編輯觀看日期"]');
  expect(buttons[index]).toBeDefined();
  buttons[index].focus();
  buttons[index].click();
});
const changeDraft = (date = draftDate) => act(async () => {
  const input = getDateInput()!;
  expect(input).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setValue.call(input, date);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  const checkboxes = getEditor()!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect(checkboxes).toHaveLength(2);
  if (checkboxes[0].checked) checkboxes[0].click();
  if (!checkboxes[1].checked) checkboxes[1].click();
});
const expectDraft = () => {
  expect(getDateInput()?.value).toBe(draftDate);
  const checkboxes = getEditor()!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect(checkboxes[0].checked).toBe(false);
  expect(checkboxes[1].checked).toBe(true);
};
const closeEditor = (method: "cancel" | "backdrop" | "escape") => act(async () => {
  if (method === "cancel") buttonNamed("取消", getEditor()!).click();
  else if (method === "backdrop") host.querySelector<HTMLButtonElement>('button[aria-label="收起紀錄編輯"]')!.click();
  else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});
const historyWrites = () => fetcher.mock.calls.filter(([url]) => String(url).endsWith("/history-upsert"));
const editorRequests = () => fetcher.mock.calls.filter(([url]) => /\/(history-upsert|history-conflicts)$/.test(String(url)));

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  WatchEventSource.instances = [];
  vi.stubGlobal("EventSource", WatchEventSource);
  headerSubscription = openWatchEventSource();
  WatchEventSource.instances[0].onopen!(new Event("open"));
  holdHistoryRead = false;
  resolveHistoryRead = null;
  vi.stubGlobal("innerWidth", 1200);
  vi.stubGlobal("innerHeight", 900);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: vi.fn() });
  tmdbId = 947000 + sequence++ * 2;
  state.auth = { session: { user: { id: `editor-${tmdbId}` } }, loading: false };
  saveMode = "success";
  sharedRecords = false;
  resolveSave = null;
  onClose = vi.fn<() => void>();
  for (const id of [tmdbId, tmdbId + 1]) {
    setDetailCache(`movie:${id}`, {
      id, media_type: "movie", title: `電影 ${id}`, release_date: "2020-01-01", countries: [], languages: [],
    });
    setDetailCache(`tv:${id}`, {
      id, media_type: "tv", title: `影集 ${id}`, status: "Ended", is_anime: false,
      seasons_info: [{ season_number: 1, episode_count: 2 }], countries: [], languages: [],
    });
    setDetailCache(`tv:${id}:season:1`, [
      { episode_number: 1, name: "第一集", air_date: "2020-01-01" },
      { episode_number: 2, name: "第二集", air_date: "2020-01-01" },
    ]);
  }
  // All requests use local fixtures; an unrecognized route cannot reach a server.
  fetcher = vi.fn<typeof fetch>(async url => {
    const path = String(url);
    if (path.endsWith("/bootstrap")) return Response.json({ inWatchlist: true, friends: [
      { friend_id: "friend-1", friend_nickname: "甲好友" },
      { friend_id: "friend-2", friend_nickname: "乙好友" },
    ] });
    if (path.endsWith("/watchlist-upsert") || path.endsWith("/tv-states/upsert")) return Response.json({ ok: true });
    if (path.endsWith("/history-episodes")) return Response.json({ rows: [
      { season_number: 1, episode_number: 1 }, { season_number: 1, episode_number: 2 },
    ], count: 2 });
    if (path.endsWith("/history-count")) return Response.json({ count: 2 });
    if (path.endsWith("/history-records") || path.endsWith("/history-season-records")) {
      if (holdHistoryRead) return new Promise<Response>(resolve => { resolveHistoryRead = resolve; });
      return Response.json({ rows: [originalDate, otherDate].map((date, index) => ({
        episode_number: index + 1, watched_at: date,
        owner_id: sharedRecords ? "another-owner" : state.auth.session.user.id,
        friend_id: index === 0 ? "friend-1" : "friend-2", friend_nickname: index === 0 ? "甲好友" : "乙好友", is_owner: false,
      })) });
    }
    if (path.endsWith("/history-conflicts")) return Response.json({
      conflictFriendIds: saveMode === "friend-conflict" ? ["friend-2"] : [],
    });
    if (path.endsWith("/history-upsert")) {
      if (saveMode === "pending") return new Promise<Response>(resolve => { resolveSave = resolve; });
      if (saveMode === "failure") return Response.json({ message: "save_failed" }, { status: 503 });
      if (saveMode === "revision-conflict") return Response.json({ code: "WATCHLIST_REVISION_CONFLICT" }, { status: 409 });
      return Response.json({ ok: true });
    }
    throw new Error(`Unexpected request in isolated editor test: ${path}`);
  });
  vi.stubGlobal("fetch", fetcher);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  headerSubscription.close();
  host.remove();
  if (originalScrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  vi.unstubAllGlobals();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

it.each([
  ["movie", "cancel"], ["movie", "backdrop"], ["tv", "cancel"], ["tv", "backdrop"],
] as const)("%s 以 %s 收起後重開同筆仍保留日期與好友，操作草稿不發送紀錄請求", async (mediaType, method) => {
  await render(mediaType);
  await edit();
  await changeDraft();
  expectDraft();
  await closeEditor(method);
  expect(getDateInput()).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  await edit();
  expectDraft();
  expect(editorRequests()).toHaveLength(0);
});

it.each(["movie", "tv"] as const)("%s 改編輯另一筆使用該筆原值，不帶入上一筆草稿", async mediaType => {
  await render(mediaType);
  await edit();
  await changeDraft();
  await closeEditor("cancel");
  await edit(1);
  expect(getDateInput()?.value).toBe(otherDate);
  const checkboxes = getEditor()!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect(checkboxes[0].checked).toBe(false);
  expect(checkboxes[1].checked).toBe(true);
  expect(editorRequests()).toHaveLength(0);
});

it.each(["account", "media", "close"] as const)("切換 %s 清除舊編輯範圍的草稿", async scope => {
  await render("movie");
  await edit();
  await changeDraft();
  await closeEditor("cancel");
  if (scope === "account") {
    state.auth = { session: { user: { id: `other-${tmdbId}` } }, loading: false };
    await render("movie");
  } else if (scope === "media") {
    await render("movie", tmdbId + 1);
    await render("movie");
  } else {
    await render("movie", tmdbId, false);
    await render("movie");
  }
  await edit();
  expect(getDateInput()?.value).toBe(originalDate);
  expect(getEditor()!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0].checked).toBe(true);
  expect(editorRequests()).toHaveLength(0);
});

it.each(["movie", "tv"] as const)("%s 僅確認時提交草稿，保留原日期及季集定位", async mediaType => {
  await render(mediaType);
  await edit();
  await changeDraft();
  expect(editorRequests()).toHaveLength(0);
  await act(async () => buttonNamed("確認紀錄", getEditor()!).click());
  expect(historyWrites()).toHaveLength(1);
  expect(JSON.parse(String(historyWrites()[0][1]?.body))).toMatchObject({
    mediaType, tmdbId, season: mediaType === "movie" ? 0 : 1, episode: mediaType === "movie" ? 0 : 1,
    watchedAt: draftDate, originalDate, friendIds: ["friend-2"],
  });
  expect(getDateInput()).toBeNull();
});

it.each([
  ["movie", "failure"], ["tv", "failure"],
  ["movie", "friend-conflict"], ["tv", "friend-conflict"],
  ["movie", "revision-conflict"], ["tv", "revision-conflict"],
] as const)("%s 提交遇到 %s 仍保留目前草稿", async (mediaType, mode) => {
  saveMode = mode;
  await render(mediaType);
  await edit();
  await changeDraft();
  await act(async () => buttonNamed("確認紀錄", getEditor()!).click());
  expectDraft();
  expect(onClose).not.toHaveBeenCalled();
  if (mode === "friend-conflict") {
    expect(historyWrites()).toHaveLength(0);
    expect(host.textContent).toContain("乙好友 有衝突紀錄");
  } else expect(historyWrites()).toHaveLength(1);
});

it.each(["movie", "tv"] as const)("%s 提交途中不能以取消、遮罩或 Escape 收起", async mediaType => {
  saveMode = "pending";
  await render(mediaType);
  await edit();
  await changeDraft();
  await act(async () => buttonNamed("確認紀錄", getEditor()!).click());
  expect(resolveSave).not.toBeNull();
  await closeEditor("cancel");
  await closeEditor("backdrop");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expectDraft();
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => resolveSave!(Response.json({ ok: true })));
  expect(getDateInput()).toBeNull();
});

it.each(["movie", "tv"] as const)("%s 舊提交在切換作品後才回傳衝突，不重開舊對話框或改掉新草稿", async mediaType => {
  saveMode = "pending";
  await render(mediaType);
  await edit();
  await changeDraft();
  await act(async () => buttonNamed("確認紀錄", getEditor()!).click());
  expect(resolveSave).not.toBeNull();
  const newMediaType = mediaType === "movie" ? "tv" : "movie";
  await render(newMediaType, tmdbId + 1);
  await edit();
  const newDraftDate = "2020-02-06";
  await changeDraft(newDraftDate);
  expect(getDateInput()?.value).toBe(newDraftDate);

  await act(async () => resolveSave!(Response.json({ code: "WATCHLIST_REVISION_CONFLICT" }, { status: 409 })));

  expect(getDateInput()?.value).toBe(newDraftDate);
  const checkboxes = getEditor()!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect(checkboxes[0].checked).toBe(false);
  expect(checkboxes[1].checked).toBe(true);
  expect(host.textContent).not.toContain("觀看紀錄已更新");
  expect(host.textContent).not.toContain("仍套用這次操作");
  expect(historyWrites()).toHaveLength(1);
  expect(onClose).not.toHaveBeenCalled();
});
it.each(["movie", "tv"] as const)("%s 好友擁有的同步紀錄不提供編輯入口", async mediaType => {
  sharedRecords = true;
  await render(mediaType);
  expect(host.querySelectorAll('button[aria-label="編輯觀看日期"]')).toHaveLength(0);
  expect(getDateInput()).toBeNull();
  expect(editorRequests()).toHaveLength(0);
});




it.each([
  ["movie", "cancel"], ["movie", "backdrop"], ["movie", "escape"],
  ["tv", "cancel"], ["tv", "backdrop"], ["tv", "escape"],
] as const)("%s 以 %s 收起且未收到更新時，不重查或重建原紀錄列", async (mediaType, method) => {
  await render(mediaType);
  await edit();
  const originalButton = host.querySelector('button[aria-label="編輯觀看日期"]');
  const requestsBeforeClose = fetcher.mock.calls.length;
  // Leave any accidental reload unresolved so even a brief loading state is caught.
  holdHistoryRead = true;
  await closeEditor(method);
  expect(getDateInput()).toBeNull();
  expect(fetcher.mock.calls).toHaveLength(requestsBeforeClose);
  expect(host.textContent).not.toContain("正在讀取資料");
  expect(host.querySelector('button[aria-label="編輯觀看日期"]')).toBe(originalButton);
  expect(WatchEventSource.instances).toHaveLength(1);
});

it.each(["movie", "tv"] as const)("%s 編輯期間收到多次更新，收起後只補查一次並保留已載入清單", async mediaType => {
  await render(mediaType);
  await edit();
  const historyPath = mediaType === "movie" ? "/history-records" : "/history-season-records";
  const historyReads = () => fetcher.mock.calls.filter(([url]) => String(url).endsWith(historyPath)).length;
  const readsBefore = historyReads();
  const originalButton = host.querySelector('button[aria-label="編輯觀看日期"]');
  const historyList = host.querySelector<HTMLElement>('[class*="scrollList"]')!;
  expect(historyList).not.toBeNull();
  historyList.scrollTop = 137;
  await act(async () => { emitUpdate(10); emitUpdate(11); emitUpdate(12); });
  expect(historyReads()).toBe(readsBefore);
  holdHistoryRead = true;
  await closeEditor("cancel");
  expect(historyReads()).toBe(readsBefore + 1);
  expect(resolveHistoryRead).not.toBeNull();
  expect(host.textContent).not.toContain("正在讀取資料");
  expect(host.querySelector('button[aria-label="編輯觀看日期"]')).toBe(originalButton);
  expect(host.querySelector('[class*="scrollList"]')).toBe(historyList);
  expect(historyList.scrollTop).toBe(137);
  if (mediaType === "tv") expect((originalButton as HTMLButtonElement).disabled).toBe(true);
  // The user can continue reading while the pending update is delivered.
  historyList.scrollTop = 220;
  const updatedDate = "2020-03-03";
  await act(async () => resolveHistoryRead!(Response.json({ rows: [{
    episode_number: 1, watched_at: updatedDate, owner_id: state.auth.session.user.id,
    friend_id: null, friend_nickname: null, is_owner: true,
  }] })));
  expect(host.textContent).toContain(updatedDate);
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="編輯觀看日期"]')?.disabled).toBe(false);
  expect(historyReads()).toBe(readsBefore + 1);
  expect(historyList.scrollTop).toBe(220);
});

it.each(["account", "media"] as const)("切換 %s 的集數紀錄仍等待新範圍載入，不沿用舊日期", async scope => {
  await render("tv");
  expect(host.textContent).toContain(originalDate);
  holdHistoryRead = true;
  if (scope === "account") {
    state.auth = { session: { user: { id: `new-${tmdbId}` } }, loading: false };
    await render("tv");
  } else await render("tv", tmdbId + 1);
  expect(host.textContent).not.toContain(originalDate);
  expect(host.querySelector('button[aria-label="編輯觀看日期"]')).toBeNull();
  expect(host.textContent).toContain("正在讀取資料");
  await act(async () => resolveHistoryRead!(Response.json({ rows: [] })));
  expect(host.textContent).not.toContain(originalDate);
});

it.each(["movie", "tv"] as const)("%s 搜尋好友的 Enter 與輸入法確認不提交，仍可按確認儲存草稿", async mediaType => {
  await render(mediaType);
  await edit();
  await changeDraft();
  const search = getEditor()!.querySelector<HTMLInputElement>('input[type="search"]')!;
  expect(search).not.toBeNull();
  await act(async () => {
    search.focus();
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setValue.call(search, "好友");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  for (const imeState of [{}, { isComposing: true }, { keyCode: 229 }]) {
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...imeState });
    await act(async () => { search.dispatchEvent(enter); });
    // jsdom does not perform implicit submission; the cancelled native default
    // proves that a browser cannot activate the form's submit button here.
    expect(enter.defaultPrevented).toBe(true);
    expect(editorRequests()).toHaveLength(0);
    expect(getEditor()).not.toBeNull();
    expectDraft();
  }
  const composingKey = new KeyboardEvent("keydown", { key: "a", keyCode: 229, isComposing: true, bubbles: true, cancelable: true });
  await act(async () => { search.dispatchEvent(composingKey); });
  expect(composingKey.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(search);
  expect(search.value).toBe("好友");
  await act(async () => buttonNamed("確認紀錄", getEditor()!).click());
  expect(historyWrites()).toHaveLength(1);
  const payload = JSON.parse(String(historyWrites()[0][1]?.body));
  expect(payload.watchedAt).toBe(draftDate);
  expect(payload.friendIds).toEqual(["friend-2"]);
});
