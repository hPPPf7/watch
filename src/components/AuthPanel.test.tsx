// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ query: "", signIn: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.query) }));
vi.mock("next-auth/react", () => ({ getProviders: async () => ({ google: {} }), signIn: state.signIn }));
vi.mock("@/hooks/useAuth", () => ({ default: () => ({ session: null, loading: false }) }));
import AuthPanel from "./AuthPanel";
let root: Root;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; sessionStorage.clear(); document.body.innerHTML = "<div id='test'></div>"; root = createRoot(document.getElementById("test")!); });
afterEach(() => { act(() => root.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = false; });
describe("登入表單驗證所有返回路徑來源", () => {
  it.each([["next=/%09/evil.example", null, "/"], ["error=OAuthError", "/\n/evil.example", "/"], ["error=OAuthError", "/calendar?year=2026#month", "/calendar?year=2026#month"], ["next=%2Fwatchlist", "//evil.example", "/watchlist"]])("query=%s stored=%s", async (query, stored, expected) => {
    state.query = query!; if (stored) sessionStorage.setItem("watch.login.next", stored);
    await act(async () => root.render(<AuthPanel />));
    await act(async () => document.querySelector("button")!.click());
    expect(state.signIn).toHaveBeenCalledWith("google", { callbackUrl: expected });
  });
});
