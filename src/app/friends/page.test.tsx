// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  session: { user: { id: "friend-page-user" } },
  refresh: null as null | (() => Promise<unknown>),
}));
vi.mock("@/hooks/useAccountFetch", () => ({ default: () => state.fetch }));
vi.mock("@/hooks/useAuth", () => ({ default: () => ({ session: state.session, loading: false }) }));
vi.mock("@/hooks/useProfileNames", () => ({ default: () => ({}) }));
vi.mock("@/hooks/useFriendNoticeRealtimeRefresh", () => ({ default: (refresh: () => Promise<unknown>) => { state.refresh = refresh; } }));
vi.mock("@/components/SiteHeader", () => ({ default: () => null }));
vi.mock("@/components/SiteFooter", () => ({ default: () => null }));
vi.mock("@/components/RequireAuthGate", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("next/image", () => ({ default: () => null }));
import FriendsPage from "./page";

let root: Root;
let host: HTMLDivElement;
const emptySummary = { incoming: [], outgoing: [], friends: [] };
const emptyMessages = ["目前沒有邀請。", "目前沒有送出邀請。", "尚未有好友資料。"];
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  state.fetch.mockReset();
  state.refresh = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

describe("好友資料的讀取與空白狀態", () => {
  it("首次讀取完成前不顯示空清單，成功讀取後才顯示", async () => {
    let resolveSummary!: (response: Response) => void;
    state.fetch.mockReturnValue(new Promise((resolve) => { resolveSummary = resolve; }));
    await act(async () => root.render(<FriendsPage />));
    expect(host.querySelector('[role="status"]')?.textContent).toContain("載入好友資料");
    for (const message of emptyMessages) expect(host.textContent).not.toContain(message);
    await act(async () => resolveSummary(Response.json(emptySummary)));
    expect(host.querySelector('[role="status"]')).toBeNull();
    for (const message of emptyMessages) expect(host.textContent).toContain(message);
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["network", "response"])("首次 %s 錯誤顯示重試且不冒充空清單", async (failure) => {
    if (failure === "network") state.fetch.mockRejectedValue(new Error("offline"));
    else state.fetch.mockResolvedValue(new Response(null, { status: 503 }));
    await act(async () => root.render(<FriendsPage />));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("好友資料讀取失敗，請重試。");
    expect(host.querySelector('[role="status"]')).toBeNull();
    for (const message of emptyMessages) expect(host.textContent).not.toContain(message);
    state.fetch.mockResolvedValue(Response.json(emptySummary));
    const retry = [...host.querySelectorAll("button")].find((button) => button.textContent === "重試")!;
    expect(retry.disabled).toBe(false);
    await act(async () => retry.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    for (const message of emptyMessages) expect(host.textContent).toContain(message);
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });

  it("重新整理失敗保留最近成功的好友和邀請", async () => {
    state.fetch.mockResolvedValue(Response.json({
      incoming: [{ id: "request-1", fromUserId: "incoming-user", fromNickname: "邀請朋友", createdAt: "2026-09-18" }],
      outgoing: [{ id: "request-2", toUserId: "outgoing-user", createdAt: "2026-09-18" }],
      friends: [{ friendId: "friend-1", friendNickname: "已加入朋友", createdAt: "2026-09-18" }],
    }));
    await act(async () => root.render(<FriendsPage />));
    state.fetch.mockRejectedValue(new Error("offline"));
    await act(async () => { await state.refresh!(); });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("好友資料讀取失敗，已保留上次資料。");
    expect(host.textContent).toContain("邀請朋友");
    expect(host.textContent).toContain("outgoing-user");
    expect(host.textContent).toContain("已加入朋友");
    for (const message of emptyMessages) expect(host.textContent).not.toContain(message);
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });
});
