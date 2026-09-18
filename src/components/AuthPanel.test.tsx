// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ query: "", signIn: vi.fn(), getProviders: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.query) }));
vi.mock("next-auth/react", () => ({ getProviders: state.getProviders, signIn: state.signIn }));
vi.mock("@/hooks/useAuth", () => ({ default: () => ({ session: null, loading: false }) }));
import AuthPanel from "./AuthPanel";

let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  state.query = "";
  state.signIn.mockReset().mockResolvedValue(undefined);
  state.getProviders.mockReset().mockResolvedValue({ google: {} });
  sessionStorage.clear();
  document.body.innerHTML = "<div id='test'></div>";
  root = createRoot(document.getElementById("test")!);
});
afterEach(() => {
  act(() => root.unmount());
  sessionStorage.clear();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

describe("登入表單驗證所有返回路徑來源", () => {
  it.each([
    ["next=/%09/evil.example", null, "/"],
    ["error=OAuthError", "/\n/evil.example", "/"],
    ["error=OAuthError", "/calendar?year=2026#month", "/calendar?year=2026#month"],
    ["next=%2Fwatchlist", "//evil.example", "/watchlist"],
  ])("query=%s stored=%s", async (query, stored, expected) => {
    state.query = query!;
    if (stored) sessionStorage.setItem("watch.login.next", stored);
    await act(async () => root.render(<AuthPanel />));
    await act(async () => document.querySelector("button")!.click());
    expect(state.signIn).toHaveBeenCalledWith("google", { callbackUrl: expected });
  });
});

describe("登入服務狀態", () => {
  it("OAuth 錯誤不依文案是否包含失敗判定錯誤", async () => {
    state.query = "error=OAuthError";
    await act(async () => root.render(<AuthPanel />));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("登入暫時無法完成，請稍後再試。");
    expect(document.querySelector("button")!.disabled).toBe(false);
  });

  it.each(["rejected", "null", "unconfigured"])("登入服務 %s 有明確錯誤並停用登入", async (mode) => {
    if (mode === "rejected") state.getProviders.mockRejectedValue(new Error("offline"));
    else state.getProviders.mockResolvedValue(mode === "null" ? null : {});
    await act(async () => root.render(<AuthPanel />));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      mode === "unconfigured" ? "Google 登入尚未設定。" : "無法載入登入服務，請稍後重新整理。",
    );
    expect(document.querySelector("button")!.disabled).toBe(true);
    expect(state.signIn).not.toHaveBeenCalled();
  });

  it("取得登入服務前顯示讀取狀態且不可送出登入", async () => {
    let resolveProviders!: (providers: { google: object }) => void;
    state.getProviders.mockReturnValue(new Promise((resolve) => { resolveProviders = resolve; }));
    await act(async () => root.render(<AuthPanel />));
    expect(document.querySelector('[role="status"]')?.textContent).toContain("載入登入服務");
    expect(document.querySelector("button")!.disabled).toBe(true);
    await act(async () => resolveProviders({ google: {} }));
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(document.querySelector("button")!.disabled).toBe(false);
  });

  it("登入請求拒絕時解除等待並可重新嘗試", async () => {
    state.signIn.mockRejectedValue(new Error("offline"));
    await act(async () => root.render(<AuthPanel />));
    await act(async () => document.querySelector("button")!.click());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("無法前往 Google 登入，請稍後再試。");
    expect(document.querySelector("button")!.disabled).toBe(false);
    state.signIn.mockResolvedValue(undefined);
    await act(async () => document.querySelector("button")!.click());
    expect(state.signIn).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('[role="status"]')?.textContent).toContain("正在前往 Google 登入");
    expect(document.querySelector("button")!.disabled).toBe(true);
  });
});
