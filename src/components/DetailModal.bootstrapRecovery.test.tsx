// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: { session: { user: { id: "bootstrap-user" } }, loading: false },
  profiles: {},
}));
vi.mock("@/hooks/useAuth", () => ({ default: () => state.auth }));
vi.mock("@/hooks/useProfileNames", () => ({ default: () => state.profiles }));
vi.mock("@/hooks/usePageActivityState", () => ({ default: () => false }));
vi.mock("@/hooks/useWatchRealtimeRefresh", () => ({ default: () => {} }));
import DetailModal from "./DetailModal";
import { setDetailCache } from "@/lib/tmdbDetailCache";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let fail: "503" | "network" | "malformed" | null;
let sequence = 0;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const id = 931211;
const render = (tmdbId = id) => act(async () => root.render(
  <DetailModal open defaultTab="history" mediaType="movie" tmdbId={tmdbId} onClose={() => {}} />,
));
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  Element.prototype.scrollIntoView = vi.fn();
  state.auth = { session: { user: { id: "bootstrap-" + sequence++ } }, loading: false };
  fail = null;
  for (const tmdbId of [id, id + 1]) setDetailCache("movie:" + tmdbId, {
    id: tmdbId, media_type: "movie", title: "測試作品", release_date: "2020-01-01",
    countries: [], languages: [],
  });
  fetcher = vi.fn<typeof fetch>(async url => {
    if (String(url).includes("/bootstrap")) {
      if (fail === "network") throw new TypeError("offline");
      if (fail) return Response.json({}, { status: fail === "503" ? 503 : 200 });
      return Response.json({ inWatchlist: true, friends: [{ friend_id: "friend-1", friend_nickname: "測試好友" }] });
    }
    return Response.json({ rows: [], count: 0 });
  });
  vi.stubGlobal("fetch", fetcher);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

it.each(["503", "network", "malformed"] as const)("清單與好友初次讀取 %s 不冒充空白，重試成功才啟用紀錄", async failure => {
  fail = failure;
  await render();
  const star = host.querySelector<HTMLButtonElement>('button[aria-label="清單狀態待確認"]')!;
  expect(star.disabled).toBe(true);
  expect(star.hasAttribute("aria-pressed")).toBe(false);
  expect(host.textContent).not.toContain("尚未有好友");
  expect(host.textContent).toContain("清單狀態與好友讀取失敗");
  const save = [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === "確認紀錄");
  expect(save?.disabled).toBe(true);
  const requestCount = fetcher.mock.calls.length;
  await act(async () => star.click());
  expect(fetcher).toHaveBeenCalledTimes(requestCount);
  fail = null;
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="重試清單狀態與好友"]')!.click());
  expect(host.querySelector('button[aria-label="移除清單"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(host.textContent).toContain("測試好友");
  expect(host.textContent).not.toContain("清單狀態與好友讀取失敗");
});

it("同作品重查失敗保留成功狀態，換作品後失敗則回到未知", async () => {
  await render();
  fail = "503";
  // The authentication provider can refresh its session object without changing accounts.
  state.auth = { ...state.auth, session: { user: { ...state.auth.session.user } } };
  await render();
  expect(host.querySelector('button[aria-label="移除清單"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(host.textContent).toContain("測試好友");
  expect(host.textContent).toContain("清單狀態與好友讀取失敗");
  await render(id + 1);
  expect(host.querySelector('button[aria-label="清單狀態待確認"]')).not.toBeNull();
  expect(host.querySelector('button[aria-label="移除清單"]')).toBeNull();
});

it("較矮視窗可使用完整詳情與可捲動內容，不顯示尺寸阻擋頁", async () => {
  vi.stubGlobal("innerWidth", 900);
  vi.stubGlobal("innerHeight", 580);
  await render();
  const dialog = host.querySelector('[role="dialog"]')!;
  expect(dialog.className).toContain("h-dvh");
  expect(host.textContent).not.toContain("視窗尺寸過小");
  expect(host.querySelector('button[aria-label="移除清單"]')).not.toBeNull();
  expect(document.activeElement).toBe(host.querySelector('[role="dialog"][aria-modal="true"]'));
});
