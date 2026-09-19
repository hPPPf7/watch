// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  router: { replace: vi.fn() },
  auth: {
    data: {
      user: { id: "account-a", email: "a@example.com", user_metadata: { full_name: "Google 名稱" } },
    } as { user: { id: string; email: string; user_metadata?: { full_name: string } } },
    status: "authenticated",
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => state.router }));
vi.mock("next-auth/react", () => ({ useSession: () => state.auth, signOut: vi.fn() }));
vi.mock("@/components/SiteHeader", () => ({ default: () => null }));
vi.mock("@/components/SiteFooter", () => ({ default: () => null }));
import { AuthProvider } from "@/providers/AuthProvider";
import AccountPage from "./page";

let root: Root;
let host: HTMLDivElement;
const render = async () => {
  await act(async () => root.render(<AuthProvider><AccountPage /></AuthProvider>));
};
const button = (label: string) => [...host.querySelectorAll("button")].find((element) => element.textContent?.trim() === label)!;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  state.fetch.mockReset();
  state.router.replace.mockReset();
  state.auth = {
    data: { user: { id: "account-a", email: "a@example.com", user_metadata: { full_name: "Google 名稱" } } },
    status: "authenticated",
  };
  vi.stubGlobal("fetch", state.fetch);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

describe("帳戶暱稱讀取狀態", () => {
  it("首次讀取完成前不能修改或顯示尚未設定", async () => {
    let resolveProfile!: (response: Response) => void;
    state.fetch.mockReturnValue(new Promise((resolve) => { resolveProfile = resolve; }));
    await render();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("載入中");
    expect(host.textContent).not.toContain("尚未設定");
    expect(button("修改").disabled).toBe(true);
    await act(async () => resolveProfile(Response.json({ nickname: "設定的暱稱" })));
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.textContent).toContain("設定的暱稱");
    expect(button("修改").disabled).toBe(false);
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["http", "network", "json"])("首次 %s 失敗提示錯誤並允許手動重試", async (failure) => {
    if (failure === "network") state.fetch.mockRejectedValue(new Error("offline"));
    else state.fetch.mockResolvedValue(failure === "http"
      ? new Response(null, { status: 503 })
      : new Response("invalid json", { status: 200 }));
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("暱稱讀取失敗，請重試。");
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.textContent).toContain("Google 名稱");
    expect(host.textContent).not.toContain("尚未設定");
    expect(button("修改").disabled).toBe(true);
    expect(state.fetch).toHaveBeenCalledTimes(1);
    let resolveRetry!: (response: Response) => void;
    state.fetch.mockReturnValue(new Promise<Response>(resolve => { resolveRetry = resolve; }));
    await act(async () => button("重試").click());
    expect(host.querySelectorAll(".watch-spinner")).toHaveLength(1);
    expect(button("重試").disabled).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("暱稱讀取失敗");
    await act(async () => resolveRetry(Response.json({ nickname: "重試讀取的暱稱" })));
    expect(host.querySelectorAll(".watch-spinner")).toHaveLength(0);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain("重試讀取的暱稱");
    expect(button("修改").disabled).toBe(false);
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });

  it("Google 名稱也不存在的讀取錯誤不當成未設定", async () => {
    state.auth.data.user.user_metadata = undefined;
    state.fetch.mockRejectedValue(new Error("offline"));
    await render();
    expect(host.textContent).toContain("無法讀取暱稱");
    expect(host.textContent).not.toContain("尚未設定");
    state.fetch.mockResolvedValue(Response.json({ nickname: null }));
    await act(async () => button("重試").click());
    expect(host.textContent).toContain("尚未設定");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("相同帳號快照重驗不多查詢，後續讀取失敗仍保留成功暱稱", async () => {
    state.fetch.mockResolvedValue(Response.json({ nickname: "自訂暱稱" }));
    await render();
    state.auth = { ...state.auth, data: structuredClone(state.auth.data) };
    await render();
    expect(state.fetch).toHaveBeenCalledTimes(1);
    state.fetch.mockRejectedValue(new Error("offline"));
    state.auth.data = {
      user: { ...state.auth.data.user, user_metadata: { full_name: "Google 新名稱" } },
    };
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("暱稱讀取失敗");
    expect(host.textContent).toContain("自訂暱稱");
    expect(host.textContent).not.toContain("Google 新名稱");
    expect(host.textContent).not.toContain("尚未設定");
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });

  it("換帳號重設刪除確認，舊帳號延遲 JSON 不覆寫新帳號", async () => {
    state.fetch.mockResolvedValue(Response.json({ nickname: "舊帳號暱稱" }));
    await render();
    await act(async () => button("選擇刪除方式").click());
    expect(host.textContent).toContain("確認刪除資料或帳號");

    let resolveOldJson!: (payload: { nickname: string }) => void;
    const oldResponse = Response.json({});
    oldResponse.json = () => new Promise((resolve) => { resolveOldJson = resolve; });
    state.fetch.mockResolvedValue(oldResponse);
    state.auth.data = {
      user: { ...state.auth.data.user, user_metadata: { full_name: "舊帳號更新" } },
    };
    await render();
    const oldSignal = state.fetch.mock.calls[1][1].signal as AbortSignal;

    state.fetch.mockResolvedValue(Response.json({ nickname: "新帳號暱稱" }));
    state.auth.data = { user: { id: "account-b", email: "b@example.com" } };
    await render();
    expect(oldSignal.aborted).toBe(true);
    expect(host.textContent).not.toContain("確認刪除資料或帳號");
    expect(host.textContent).toContain("新帳號暱稱");
    expect(host.textContent).not.toContain("舊帳號暱稱");
    await act(async () => resolveOldJson({ nickname: "舊帳號延遲結果" }));
    expect(host.textContent).toContain("新帳號暱稱");
    expect(host.textContent).not.toContain("舊帳號延遲結果");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(state.fetch).toHaveBeenCalledTimes(3);
  });
});
