// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  auth: { session: { user: { id: "logout-user", email: "a@example.com" } }, loading: false },
}));
vi.mock("next-auth/react", () => ({ signOut: mocks.signOut }));
vi.mock("next/navigation", () => ({ usePathname: () => "/movies" }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a> }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/components/MediaCard", () => ({ default: () => null }));
vi.mock("@/components/DetailModal", () => ({ default: () => null }));
vi.mock("@/hooks/useAuth", () => ({ default: () => mocks.auth }));
vi.mock("@/hooks/usePageActivityState", () => ({ default: () => false }));
vi.mock("@/hooks/useWatchRealtimeRefresh", () => ({ default: () => {} }));
vi.mock("@/features/site-header/usePendingFriendCount", () => ({ default: () => 0 }));
import SiteHeader from "./SiteHeader";

it.each([true, false])("登出成功=%s 只清目前帳號的所有版本快取，失敗時保留", async success => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mocks.signOut.mockImplementation(async () => { if (!success) throw new Error("offline"); });
  const owned = ["watchlist:section:logout-user:movie:false", "watchlist:section:v2:logout-user:tv:false", "watchlist:had-data:logout-user:tv:false", "watchlist:upcoming-episodes:logout-user:tv:true"];
  for (const storage of [localStorage, sessionStorage]) {
    storage.clear();
    for (const key of owned) storage.setItem(key, "private history");
    storage.setItem("watchlist:section:v2:other:movie:false", "keep");
    storage.setItem("theme", "dark");
  }
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ avatarUrl: null })));
  const host = document.createElement("div");
  const root = createRoot(host);
  const click = async (text: string) => {
    const button = [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === text);
    expect(button).toBeTruthy();
    await act(async () => button!.click());
  };
  try {
    await act(async () => root.render(<SiteHeader />));
    await click("A");
    await click("登出");
    await click("確認登出");
    expect(mocks.signOut).toHaveBeenCalledWith({ redirect: false });
    for (const storage of [localStorage, sessionStorage]) {
      for (const key of owned) expect(storage.getItem(key)).toBe(success ? null : "private history");
      expect(storage.getItem("watchlist:section:v2:other:movie:false")).toBe("keep");
      expect(storage.getItem("theme")).toBe("dark");
    }
  } finally {
    await act(async () => root.unmount());
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  }
});
