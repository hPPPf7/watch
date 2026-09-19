// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("集數觀看紀錄讀取復原", () => {
  type SeasonRequest = { tmdbId: number; season: number };
  let sequence = 0;
  let tmdbId: number;
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let loadSeason: (request: SeasonRequest) => Promise<Response>;
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  let onEpisodeListViewed: ReturnType<typeof vi.fn<(id: number) => void>>;
  let originalScrollIntoView: PropertyDescriptor | undefined;

  const watchedRows = () => [{
    episode_number: 1,
    watched_at: "2026-09-01",
    owner_id: state.auth.session.user.id,
    friend_id: null,
    friend_nickname: null,
    is_owner: true,
  }];
  const historyRequests = () => fetcher.mock.calls.filter(([url]) =>
    String(url).endsWith("/history-season-records"),
  );
  const failResponse = async (failure: string) => {
    if (failure === "network") throw new TypeError("offline");
    return Response.json(
      failure === "malformed" ? { rows: {} } : {},
      { status: failure === "503" ? 503 : 200 },
    );
  };
  const render = (id = tmdbId) => act(async () => root.render(
    <DetailModal open defaultTab="history" mediaType="tv" tmdbId={id}
      onClose={() => {}} onEpisodeListViewed={onEpisodeListViewed} />,
  ));
  const selectSeason = (season: number) => act(async () => {
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="選擇季數"]');
    expect(select).not.toBeNull();
    select!.value = String(season);
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const retryHistory = () => {
    const retry = host.querySelector<HTMLButtonElement>('button[aria-label="重試集數觀看紀錄"]');
    expect(retry).not.toBeNull();
    expect(retry!.disabled).toBe(false);
    return act(async () => retry!.click());
  };
  const expectNoPendingHistory = () => {
    expect(host.textContent).not.toContain("正在讀取資料");
    expect(host.textContent).not.toContain("正在更新紀錄");
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("innerWidth", 1200);
    vi.stubGlobal("innerHeight", 900);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
    originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true, writable: true, value: vi.fn(),
    });
    tmdbId = 948800 + sequence++ * 2;
    state.auth = { session: { user: { id: "episode-recovery-" + tmdbId } }, loading: false };
    state.refresh = null;
    onEpisodeListViewed = vi.fn();
    for (const id of [tmdbId, tmdbId + 1]) {
      setDetailCache("tv:" + id, {
        id, media_type: "tv", title: "影集 " + id, status: "Ended",
        seasons_info: [
          { season_number: 1, episode_count: 2 },
          { season_number: 2, episode_count: 2 },
        ],
        countries: [], languages: [],
      });
      for (const season of [1, 2]) {
        setDetailCache("tv:" + id + ":season:" + season, [
          { episode_number: 1, name: "第" + season + "季開場", air_date: "2020-01-01" },
          { episode_number: 2, name: "第" + season + "季結尾", air_date: "2020-01-01" },
        ]);
      }
    }
    loadSeason = async () => Response.json({ rows: watchedRows() });
    // All responses are local fixtures, including reads triggered by realtime refresh.
    fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const path = String(url);
      if (path.endsWith("/history-season-records")) return loadSeason(JSON.parse(String(init?.body)));
      if (path.endsWith("/bootstrap")) return Response.json({ inWatchlist: true, friends: [] });
      if (path.endsWith("/history-episodes")) return Response.json({ rows: [], count: 1 });
      if (path.endsWith("/history-count")) return Response.json({ count: 1 });
      if (path.endsWith("/watchlist-upsert")) return Response.json({ ok: true });
      throw new Error("Unexpected request in isolated history recovery test: " + path);
    });
    vi.stubGlobal("fetch", fetcher);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    if (originalScrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
    else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    state.auth = { session: { user: { id: "history-recovery" } }, loading: false };
    state.refresh = null;
    vi.unstubAllGlobals();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("季數偏好與集數紀錄斷線時仍可重試紀錄，不重讀季數偏好", async () => {
    const localFetch = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/history-episodes")) throw new TypeError("offline");
      return localFetch(url, init);
    });
    const preferenceRequests = () => fetcher.mock.calls.filter(([url]) =>
      String(url).endsWith("/history-episodes"),
    );
    loadSeason = () => failResponse("network");

    await render();

    expect(preferenceRequests()).toHaveLength(1);
    expect(historyRequests()).toHaveLength(1);
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="選擇季數"]')?.value).toBe("1");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("觀看紀錄讀取失敗");
    expect(host.querySelector('button[aria-label="重試集數觀看紀錄"]')).not.toBeNull();
    expectNoPendingHistory();
    expect(host.querySelectorAll('button[aria-label="編輯觀看日期"]')).toHaveLength(0);
    expect(host.querySelectorAll('button[aria-label="紀錄觀看日期"]')).toHaveLength(0);

    loadSeason = async () => Response.json({ rows: watchedRows() });
    await retryHistory();

    expect(preferenceRequests()).toHaveLength(1);
    expect(historyRequests()).toHaveLength(2);
    expect(JSON.parse(String(historyRequests().at(-1)![1]?.body))).toMatchObject({ tmdbId, season: 1 });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expectNoPendingHistory();
    expect(host.textContent).toContain("第1季開場");
    expect(host.querySelectorAll('button[aria-label="編輯觀看日期"]')).toHaveLength(1);
    expect(host.querySelectorAll('button[aria-label="紀錄觀看日期"]')).toHaveLength(1);
  });

  it.each(["503", "network", "malformed"])("首次讀取 %s 時結束載入，手動重試後顯示紀錄", async failure => {
    loadSeason = () => failResponse(failure);
    await render();

    expect(historyRequests()).toHaveLength(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("觀看紀錄讀取失敗");
    expectNoPendingHistory();
    expect(host.querySelectorAll('button[aria-label="編輯觀看日期"]')).toHaveLength(0);
    expect(host.querySelectorAll('button[aria-label="紀錄觀看日期"]')).toHaveLength(0);
    expect(host.textContent).not.toContain("尚未取得集數資料");
    expect(onEpisodeListViewed).not.toHaveBeenCalled();

    let resolveRetry!: (response: Response) => void;
    loadSeason = () => new Promise<Response>(resolve => { resolveRetry = resolve; });
    await retryHistory();
    expect(host.querySelectorAll(".watch-spinner")).toHaveLength(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("觀看紀錄讀取失敗");
    await act(async () => resolveRetry(Response.json({ rows: watchedRows() })));
    expect(host.querySelectorAll(".watch-spinner")).toHaveLength(0);

    expect(historyRequests()).toHaveLength(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expectNoPendingHistory();
    expect(host.textContent).toContain("第1季開場");
    expect(host.querySelectorAll('button[aria-label="編輯觀看日期"]')).toHaveLength(1);
    expect(host.querySelectorAll('button[aria-label="紀錄觀看日期"]')).toHaveLength(1);
    expect(onEpisodeListViewed).toHaveBeenCalledOnce();
    expect(onEpisodeListViewed).toHaveBeenCalledWith(tmdbId);
  });

  it.each(["503", "network", "malformed"])("背景讀取 %s 保留同季紀錄，成功的空結果才清除紀錄", async failure => {
    await render();
    expect(host.querySelectorAll('button[aria-label="編輯觀看日期"]')).toHaveLength(1);

    loadSeason = () => failResponse(failure);
    await act(async () => state.refresh!({ source: "event", reason: "history_upsert" }));

    expect(host.querySelector('[role="alert"]')?.textContent).toContain("觀看紀錄讀取失敗");
    expectNoPendingHistory();
    expect(host.querySelectorAll('button[aria-label="編輯觀看日期"]')).toHaveLength(1);
    expect(host.querySelectorAll('button[aria-label="紀錄觀看日期"]')).toHaveLength(1);
    expect(host.textContent).toContain("第1季開場");

    let resolveRetry!: (response: Response) => void;
    loadSeason = () => new Promise<Response>(resolve => { resolveRetry = resolve; });
    await retryHistory();
    expect(host.querySelectorAll(".watch-spinner")).toHaveLength(1);
    expect(host.querySelectorAll('button[aria-label="編輯觀看日期"]')).toHaveLength(1);
    await act(async () => resolveRetry(Response.json({ rows: [] })));
    expect(host.querySelectorAll(".watch-spinner")).toHaveLength(0);

    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelectorAll('button[aria-label="編輯觀看日期"]')).toHaveLength(0);
    expect(host.querySelectorAll('button[aria-label="紀錄觀看日期"]')).toHaveLength(2);
  });

  it("切季讀取失敗時不沿用前一季紀錄，重試只載入目前季數", async () => {
    await render();
    loadSeason = async ({ season }) => season === 2
      ? Response.json({}, { status: 503 })
      : Response.json({ rows: watchedRows() });
    await selectSeason(2);

    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expectNoPendingHistory();
    expect(host.querySelector<HTMLSelectElement>("select")?.value).toBe("2");
    expect(host.textContent).not.toContain("第1季開場");
    expect(host.querySelectorAll('button[aria-label="編輯觀看日期"]')).toHaveLength(0);
    expect(host.querySelectorAll('button[aria-label="紀錄觀看日期"]')).toHaveLength(0);

    loadSeason = async () => Response.json({ rows: [] });
    await retryHistory();

    const lastRequest = historyRequests().at(-1)!;
    expect(JSON.parse(String(lastRequest[1]?.body))).toMatchObject({ tmdbId, season: 2 });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain("第2季開場");
    expect(host.querySelectorAll('button[aria-label="編輯觀看日期"]')).toHaveLength(0);
    expect(host.querySelectorAll('button[aria-label="紀錄觀看日期"]')).toHaveLength(2);
  });

  it("切季後清除前一季錯誤，新的紀錄未回應前保持載入狀態", async () => {
    loadSeason = async () => Response.json({}, { status: 503 });
    await render();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();

    let resolveSeason!: (response: Response) => void;
    loadSeason = () => new Promise<Response>(resolve => { resolveSeason = resolve; });
    await selectSeason(2);

    expect(resolveSeason).toBeTypeOf("function");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('button[aria-label="重試集數觀看紀錄"]')).toBeNull();
    expect(host.textContent).toContain("正在讀取資料");
    await act(async () => resolveSeason(Response.json({ rows: [] })));

    expect(host.querySelector('[role="alert"]')).toBeNull();
    expectNoPendingHistory();
    expect(host.textContent).toContain("第2季開場");
    expect(host.querySelectorAll('button[aria-label="紀錄觀看日期"]')).toHaveLength(2);
  });
  it.each(["success", "failure"])("切季後忽略前一季延遲的 %s 回應", async result => {
    await render();
    let resolveOldRequest!: (response: Response) => void;
    loadSeason = ({ season }) => season === 1
      ? new Promise<Response>(resolve => { resolveOldRequest = resolve; })
      : Promise.resolve(Response.json({ rows: [] }));
    let refresh!: Promise<void>;
    await act(async () => { refresh = state.refresh!({ source: "event", reason: "history_upsert" }); });
    expect(resolveOldRequest).toBeTypeOf("function");

    await selectSeason(2);
    expect(host.textContent).toContain("第2季開場");
    await act(async () => {
      resolveOldRequest(result === "success"
        ? Response.json({ rows: watchedRows() })
        : Response.json({}, { status: 503 }));
      await refresh;
    });

    expect(host.querySelector<HTMLSelectElement>("select")?.value).toBe("2");
    expect(host.textContent).toContain("第2季開場");
    expect(host.textContent).not.toContain("第1季開場");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expectNoPendingHistory();
    expect(host.querySelectorAll('button[aria-label="編輯觀看日期"]')).toHaveLength(0);
    expect(host.querySelectorAll('button[aria-label="紀錄觀看日期"]')).toHaveLength(2);
  });

  it.each(["media", "account"])("切換 %s 後讀取失敗不保留其他範圍的紀錄", async scope => {
    await render();
    expect(host.querySelectorAll('button[aria-label="編輯觀看日期"]')).toHaveLength(1);
    loadSeason = async () => Response.json({}, { status: 503 });
    if (scope === "account") {
      state.auth = { session: { user: { id: "another-account-" + tmdbId } }, loading: false };
    }
    await render(scope === "media" ? tmdbId + 1 : tmdbId);

    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expectNoPendingHistory();
    expect(host.querySelectorAll('button[aria-label="編輯觀看日期"]')).toHaveLength(0);
    expect(host.querySelectorAll('button[aria-label="紀錄觀看日期"]')).toHaveLength(0);
    expect(host.querySelector('button[aria-label="重試集數觀看紀錄"]')).not.toBeNull();
  });
});
