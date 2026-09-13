// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  auth: { session: { user: { id: "history-recovery" } }, loading: false },
  profiles: {},
  refresh: null as null | ((trigger: unknown) => Promise<void>),
}));
vi.mock("@/hooks/useAuth", () => ({ default: () => state.auth }));
vi.mock("@/hooks/useProfileNames", () => ({ default: () => state.profiles }));
vi.mock("@/hooks/usePageActivityState", () => ({ default: () => false }));
vi.mock("@/hooks/useWatchRealtimeRefresh", () => ({
  default: (callback: (trigger: unknown) => Promise<void>) => { state.refresh = callback; },
}));
import DetailModal from "./DetailModal";
import { setDetailCache } from "@/lib/tmdbDetailCache";

it.each(["503", "network", "malformed"])("電影紀錄背景讀取 %s 時保留資料，並可手動重試", async failure => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  Element.prototype.scrollIntoView = vi.fn();
  const id = 918334;
  let fail = false;
  let empty = false;
  setDetailCache(`movie:${id}`, { id, media_type: "movie", title: "紀錄測試", year: "2020", release_date: "2020-01-01", countries: [], languages: [] });
  const fetcher = vi.fn<typeof fetch>(async url => {
    if (String(url).includes("/history-records")) {
      if (fail) {
        if (failure === "network") throw new TypeError("offline");
        return Response.json({}, { status: failure === "503" ? 503 : 200 });
      }
      return Response.json({ rows: empty ? [] : [{ watched_at: "2026-09-01", owner_id: "history-recovery", friend_id: null, friend_nickname: null, is_owner: true }] });
    }
    return Response.json({ rows: [], count: 1, friends: [], inWatchlist: true });
  });
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<DetailModal open defaultTab="history" mediaType="movie" tmdbId={id} onClose={() => {}} />));
    expect(host.querySelectorAll('button[aria-label="編輯觀看日期"]')).toHaveLength(1);
    fail = true;
    await act(async () => state.refresh!({ source: "event", reason: "history_upsert" }));
    expect(host.querySelectorAll('button[aria-label="編輯觀看日期"]')).toHaveLength(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("觀看紀錄讀取失敗");
    expect(host.textContent).not.toContain("尚未建立觀看紀錄");
    const retry = [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === "重試")!;
    expect(retry.disabled).toBe(false);
    fail = false;
    await act(async () => retry.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelectorAll('button[aria-label="編輯觀看日期"]')).toHaveLength(1);
    // A confirmed empty response is still authoritative.
    empty = true;
    await act(async () => state.refresh!({ source: "event", reason: "history_delete" }));
    expect(host.textContent).toContain("尚未建立觀看紀錄");
    expect(host.querySelectorAll('button[aria-label="編輯觀看日期"]')).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  }
});

it("切到另一部電影讀取失敗時不沿用前一部紀錄，也不聲稱沒有紀錄", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  Element.prototype.scrollIntoView = vi.fn();
  for (const id of [918335, 918336]) setDetailCache(`movie:${id}`, { id, media_type: "movie", title: "電影" + id, release_date: "2020-01-01", countries: [], languages: [] });
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).includes("/history-records")) {
      const { tmdbId } = JSON.parse(String(init?.body));
      if (tmdbId === 918336) return Response.json({}, { status: 503 });
      return Response.json({ rows: [{ watched_at: "2026-09-01", owner_id: "history-recovery", is_owner: true }] });
    }
    return Response.json({ rows: [], count: 1, friends: [], inWatchlist: true });
  }));
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<DetailModal open defaultTab="history" mediaType="movie" tmdbId={918335} onClose={() => {}} />));
    expect(host.querySelectorAll('button[aria-label="編輯觀看日期"]')).toHaveLength(1);
    await act(async () => root.render(<DetailModal open defaultTab="history" mediaType="movie" tmdbId={918336} onClose={() => {}} />));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelectorAll('button[aria-label="編輯觀看日期"]')).toHaveLength(0);
    expect(host.textContent).not.toContain("尚未建立觀看紀錄");
    expect(host.textContent).not.toContain("共 0 筆紀錄");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  }
});
