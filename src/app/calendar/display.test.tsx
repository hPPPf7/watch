// @vitest-environment jsdom
import { act, Profiler, type ReactNode } from "react";
import type { WatchRealtimeRefreshTrigger } from "@/hooks/useWatchRealtimeRefresh";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { session: { user: { id: "viewer" } }, loading: false },
  accountFetch: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  profileLookups: vi.fn<(ids: string[]) => void>(),
  realtimeHook: vi.fn<(refresh: (trigger: WatchRealtimeRefreshTrigger) => Promise<void>) => void>(),
  profiles: {
    viewer: { nickname: "我自己", avatarUrl: null },
    "friend-owner": { nickname: "紀錄主人", avatarUrl: null },
    "friend-visible": { nickname: "一起看的好友", avatarUrl: null },
    "hidden-other": { nickname: "不應顯示的名字", avatarUrl: null },
  },
}));

vi.mock("@/hooks/useAuth", () => ({ default: () => mocks.auth }));
vi.mock("@/hooks/useAccountFetch", () => ({ default: () => mocks.accountFetch }));
vi.mock("@/hooks/useProfileNames", async () => {
  const { useEffect } = await import("react");
  return {
    default: function useMockProfileNames(ids: string[]) {
      // Match the hook's ID-based lookup boundary without making profile requests.
      const idsKey = [...new Set(ids)].join("|");
      useEffect(() => {
        mocks.profileLookups(idsKey ? idsKey.split("|") : []);
      }, [idsKey]);
      return mocks.profiles;
    },
  };
});
vi.mock("@/hooks/useWatchRealtimeRefresh", () => ({ default: mocks.realtimeHook }));
vi.mock("@/components/SiteHeader", () => ({ default: () => null }));
vi.mock("@/components/SiteFooter", () => ({ default: () => null }));
vi.mock("@/components/RequireAuthGate", () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("next/image", () => ({ default: () => null }));

import CalendarPage from "./page";
import calendarStyles from "@/components/CalendarMonthView.module.css";

const LONG_TITLE = "這是一部超過月曆格寬度而且在當日明細仍然必須完整顯示的電影標題".repeat(3);
const MOVIE_TITLES = [LONG_TITLE, ...Array.from({ length: 6 }, (_, index) => `同日電影第${index + 2}部`)];
const SERIES_TITLE = "跨集數的完整影集名稱";
const NEXT_DAY_TITLE = "隔天的唯一紀錄";
const ADJACENT_MONTH_TITLE = "相鄰月份的補格紀錄";

type HistoryRow = {
  history_id: string;
  tmdb_id: number;
  media_type: "movie" | "tv";
  season_number: number | null;
  episode_number: number | null;
  watched_at: string;
  owner_id: string;
  companion_id: string | null;
};
type MonthRequest = {
  year: number;
  month: number;
  scope: "grid" | "month";
  selectedFriendId: string;
  selectedFriendIds?: string[];
};

const dateKey = (year: number, month: number, day: number) => {
  const date = new Date(year, month, day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const historyFixture = ({ year, month, scope }: MonthRequest) => {
  const movie = (id: number, watchedAt: string): HistoryRow => ({
    history_id: `history-${id}-${watchedAt}`,
    tmdb_id: id,
    media_type: "movie",
    season_number: null,
    episode_number: null,
    watched_at: watchedAt,
    owner_id: "viewer",
    companion_id: null,
  });
  const rows = MOVIE_TITLES.map((_, index) => movie(100 + index, dateKey(year, month, 18)));
  for (const episode of [1, 2, 4]) {
    for (const companion of ["viewer", "friend-visible", "hidden-other"]) {
      rows.push({
        history_id: `series-episode-${episode}`,
        tmdb_id: 200,
        media_type: "tv",
        season_number: 2,
        episode_number: episode,
        watched_at: dateKey(year, month, 18),
        owner_id: "friend-owner",
        companion_id: companion,
      });
    }
  }
  rows.push(movie(300, dateKey(year, month, 19)));
  if (scope === "grid") rows.push(movie(400, dateKey(year, month, 0)));
  return { rows, edge_rows: [], movie_items: [], tv_items: [] };
};

const titles = Object.fromEntries([
  ...MOVIE_TITLES.map((title, index) => [`movie:${100 + index}`, { title, is_anime: false }]),
  ["tv:200", { title: SERIES_TITLE, is_anime: false }],
  ["movie:300", { title: NEXT_DAY_TITLE, is_anime: false }],
  ["movie:400", { title: ADJACENT_MONTH_TITLE, is_anime: false }],
]);

describe("Calendar D day details", () => {
  let host: HTMLDivElement;
  let root: Root;
  let unexpectedFetch: ReturnType<typeof vi.fn>;

  const buttonByText = (label: string) => {
    const button = [...host.querySelectorAll("button")].find((item) =>
      item.textContent?.trim() === label || item.querySelector("span")?.textContent?.trim() === label,
    );
    expect(button, `Missing button: ${label}`).toBeDefined();
    return button!;
  };
  const dayButton = (day: number, count: number) => {
    const label = new RegExp(`查看\\s*9\\s*月\\s*${day}\\s*日.*${count}\\s*筆紀錄`);
    const button = [...host.querySelectorAll("button")].find((item) => label.test(item.getAttribute("aria-label") ?? ""));
    expect(button, `Missing day button for September ${day}`).toBeDefined();
    return button!;
  };
  const panel = () => host.querySelector<HTMLElement>('aside[aria-label="當日完整紀錄"]');
  const click = async (button: HTMLButtonElement) => {
    await act(async () => button.click());
  };
  const mount = async () => {
    await act(async () => root.render(<CalendarPage />));
    expect(mocks.accountFetch.mock.calls.some(([url]) => url === "/api/media/titles")).toBe(true);
  };
  const monthRequests = () => mocks.accountFetch.mock.calls
    .filter(([url]) => url === "/api/calendar/month-data")
    .map(([, init]) => JSON.parse(init!.body as string) as MonthRequest);
  const lookupSnapshot = () => ({
    accountRequests: mocks.accountFetch.mock.calls.length,
    profileLookups: mocks.profileLookups.mock.calls.length,
    directRequests: unexpectedFetch.mock.calls.length,
  });
  const setViewport = async (width: number, height: number) => {
    vi.stubGlobal("innerWidth", width);
    vi.stubGlobal("innerHeight", height);
    await act(async () => window.dispatchEvent(new Event("resize")));
  };

  beforeEach(() => {
    mocks.auth.session = { user: { id: "viewer" } };
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-18T12:00:00+08:00"));
    vi.stubGlobal("innerWidth", 1440);
    vi.stubGlobal("innerHeight", 1000);
    unexpectedFetch = vi.fn(async () => {
      throw new Error("Unexpected unmocked network request");
    });
    vi.stubGlobal("fetch", unexpectedFetch);
    mocks.accountFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/calendar/friends") {
        return Response.json({
          rows: [
            { friend_id: "friend-owner", friend_nickname: "主人的舊暱稱" },
            { friend_id: "friend-visible", friend_nickname: "好友的舊暱稱" },
          ],
        });
      }
      if (url === "/api/calendar/month-data") {
        return Response.json(historyFixture(JSON.parse(init!.body as string) as MonthRequest));
      }
      if (url === "/api/media/titles") return Response.json({ titles });
      if (url === "/api/calendar/edge") return Response.json({ edge: "2026-10-19" });
      throw new Error(`Unexpected account request: ${url}`);
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    expect(unexpectedFetch).not.toHaveBeenCalled();
  });

  it("opens every loaded record with complete titles and only visible friends", async () => {
    await mount();
    expect(panel()).toBeNull();
    expect(monthRequests().at(-1)).toMatchObject({ year: 2026, month: 8, scope: "grid" });

    await click(dayButton(18, 8));
    const details = panel()!;
    expect(details).not.toBeNull();
    expect(details.querySelectorAll("article")).toHaveLength(8);
    for (const title of MOVIE_TITLES) expect(details.textContent).toContain(title);
    expect(details.textContent).toContain(SERIES_TITLE);
    expect(details.textContent).toContain("S2E1–E2、E4");
    expect(details.textContent).toContain("紀錄主人");
    expect(details.textContent).toContain("一起看的好友");
    expect(details.textContent).not.toMatch(/不應顯示的名字|hidden-other|我自己/);
    const ownerName = [...details.querySelectorAll("span")].find((element) => element.textContent === "紀錄主人");
    expect(ownerName?.parentElement?.classList.contains(calendarStyles.owner)).toBe(true);
    const companionName = [...details.querySelectorAll("span")].find((element) => element.textContent === "一起看的好友");
    expect(companionName?.parentElement?.classList.contains(calendarStyles.owner)).toBe(false);
    expect(mocks.profileLookups.mock.calls.at(-1)?.[0]).toEqual(["viewer", "friend-owner", "friend-visible"]);
    expect(mocks.profileLookups.mock.calls.flat(2)).not.toContain("hidden-other");
  });

  it("switches days and closes with X or Escape without repeating any data lookup", async () => {
    await mount();
    const before = lookupSnapshot();
    await click(dayButton(18, 8));
    expect(panel()?.textContent).toContain(LONG_TITLE);
    panel()!.querySelector<HTMLElement>('[role="region"]')!.scrollTop = 120;
    await click(dayButton(19, 1));
    expect(panel()!.querySelector<HTMLElement>('[role="region"]')!.scrollTop).toBe(0);
    expect(panel()?.textContent).toContain(NEXT_DAY_TITLE);
    expect(panel()?.textContent).not.toContain(LONG_TITLE);
    expect(panel()?.querySelectorAll("article")).toHaveLength(1);
    await click(dayButton(20, 0));
    expect(panel()).not.toBeNull();
    expect(panel()?.querySelectorAll("article")).toHaveLength(0);
    const closeButton = host.querySelector<HTMLButtonElement>('button[aria-label="關閉當日明細"]')!;
    expect(closeButton).not.toBeNull();
    await click(closeButton);
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(dayButton(20, 0));

    await click(dayButton(18, 8));
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(dayButton(18, 8));
    expect(lookupSnapshot()).toEqual(before);
  });

  it("retains a same-account refresh snapshot but hides it in every commit after an account switch", async () => {
    const commits: Array<{ viewer: string; text: string }> = [];
    const recordCommit = () => {
      commits.push({ viewer: mocks.auth.session.user.id, text: host.textContent ?? "" });
    };
    const page = () => <Profiler id="calendar" onRender={recordCommit}><CalendarPage /></Profiler>;
    await act(async () => root.render(page()));
    await click(dayButton(18, 8));
    const originalPanel = panel()!;
    const originalRecords = originalPanel.querySelector<HTMLElement>('[role="region"]')!;
    originalRecords.scrollTop = 120;
    const before = lookupSnapshot();
    const respondNormally = mocks.accountFetch.getMockImplementation()!;
    const pending: Array<{ viewer: string; resolve: (response: Response) => void }> = [];
    mocks.accountFetch.mockImplementation((input, init) => {
      if (String(input) === "/api/calendar/month-data") {
        return new Promise<Response>((resolve) => {
          pending.push({ viewer: mocks.auth.session.user.id, resolve });
        });
      }
      return respondNormally(input, init);
    });

    await act(async () => {
      await mocks.realtimeHook.mock.calls.at(-1)![0]({ source: "event", reason: "history_upsert" });
    });
    expect(pending.map(({ viewer }) => viewer)).toEqual(["viewer"]);
    expect(panel()).toBe(originalPanel);
    expect(panel()!.querySelector('[role="region"]')).toBe(originalRecords);
    expect(originalRecords.scrollTop).toBe(120);
    expect(panel()?.textContent).toContain(LONG_TITLE);
    expect(panel()?.querySelectorAll("article")).toHaveLength(8);
    expect(lookupSnapshot()).toEqual({ ...before, accountRequests: before.accountRequests + 1 });

    mocks.auth.session = { user: { id: "second-viewer" } };
    await act(async () => root.render(page()));
    expect(pending.map(({ viewer }) => viewer)).toEqual(["viewer", "second-viewer"]);
    expect(panel()).toBeNull();
    const nextAccountCommits = commits.filter(({ viewer }) => viewer === "second-viewer");
    expect(nextAccountCommits.length).toBeGreaterThan(0);
    // Profiler observes each committed DOM before passive effects can erase a
    // stale snapshot, so an effect-only clear cannot satisfy this assertion.
    for (const { text } of nextAccountCommits) {
      for (const title of [...MOVIE_TITLES, SERIES_TITLE, NEXT_DAY_TITLE, ADJACENT_MONTH_TITLE]) {
        expect(text).not.toContain(title);
      }
    }

    await act(async () => {
      pending[0].resolve(Response.json(historyFixture(monthRequests()[0])));
    });
    expect(panel()).toBeNull();
    expect(host.textContent).not.toContain(LONG_TITLE);

    const nextAccountTitle = "第二個帳號的專屬紀錄";
    await act(async () => {
      pending[1].resolve(Response.json({
        rows: [{
          history_id: "second-account-record",
          tmdb_id: 900,
          media_type: "movie",
          season_number: null,
          episode_number: null,
          watched_at: "2026-09-18",
          owner_id: "second-viewer",
          companion_id: null,
        }],
        movie_items: [{ tmdb_id: 900, media_type: "movie", title: nextAccountTitle, is_anime: false }],
        tv_items: [],
        edge_rows: [],
      }));
    });
    expect(host.textContent).toContain(nextAccountTitle);
    expect(host.textContent).not.toContain(LONG_TITLE);
    expect(panel()).toBeNull();
    await click(dayButton(18, 1));
    expect(panel()?.textContent).toContain(nextAccountTitle);
    expect(panel()?.querySelectorAll("article")).toHaveLength(1);
    expect(panel()?.textContent).not.toContain(LONG_TITLE);
  });

  it.each(["自己單獨看", "好友篩選", "下個月", "條列"] as const)(
    "resets the open details when changing %s while keeping the established request scope",
    async (change) => {
      await mount();
      await click(dayButton(18, 8));
      expect(panel()).not.toBeNull();
      const before = monthRequests().length;
      if (change === "好友篩選") {
        await click(buttonByText("篩選好友"));
        await click(buttonByText("一起看的好友"));
        await click(buttonByText("確認"));
      } else {
        await click(buttonByText(change));
      }
      expect(panel()).toBeNull();
      expect(monthRequests()).toHaveLength(before + 1);
      expect(monthRequests().at(-1)).toMatchObject({
        year: 2026,
        month: change === "下個月" ? 9 : 8,
        scope: change === "條列" ? "month" : "grid",
        selectedFriendId: change === "自己單獨看" ? "self" : "all",
        ...(change === "好友篩選" ? { selectedFriendIds: ["friend-visible"] } : {}),
      });
      if (change === "條列") {
        await click(buttonByText("月曆"));
        expect(panel()).toBeNull();
        expect(monthRequests().at(-1)?.scope).toBe("grid");
      }
    },
  );

  it.each([[390, 844], [1440, 600]])(
    "resets details and uses the month-only list at a compact viewport (%i × %i)",
    async (width, height) => {
      await mount();
      await click(dayButton(18, 8));
      await setViewport(width, height);
      expect(panel()).toBeNull();
      expect(monthRequests().at(-1)?.scope).toBe("month");
      expect(host.textContent).toContain(LONG_TITLE);
      expect(host.textContent).not.toContain(ADJACENT_MONTH_TITLE);
      expect(host.textContent).not.toMatch(/不應顯示的名字|hidden-other|我自己/);
      expect([...host.querySelectorAll("button")].some((button) => button.textContent?.trim() === "月曆")).toBe(false);

      await setViewport(1440, 1000);
      expect(panel()).toBeNull();
      expect(monthRequests().at(-1)?.scope).toBe("grid");
    },
  );
});
