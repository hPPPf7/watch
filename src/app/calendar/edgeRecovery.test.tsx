// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ session: { user: { id: "edge-user" } }, loading: false }));
vi.mock("@/hooks/useAuth", () => ({ default: () => auth }));
vi.mock("@/hooks/useProfileNames", () => ({ default: () => ({}) }));
vi.mock("@/hooks/useWatchRealtimeRefresh", () => ({ default: () => {} }));
vi.mock("@/components/SiteHeader", () => ({ default: () => null }));
vi.mock("@/components/SiteFooter", () => ({ default: () => null }));
import CalendarPage from "./page";
it("keeps the current month when either edge read fails and permits another jump", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let failing = true;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/edge")) {
      const body = JSON.parse(init!.body as string);
      if (body.selectedFriendId === "all" && failing) return new Response(null, { status: 503 });
      return Response.json({ edge: body.selectedFriendId === "self" ? "2025-01-01" : "2025-06-01" });
    }
    return Response.json({ rows: [], friends: [] });
  });
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<CalendarPage />));
    const before = host.querySelector("h1")!.textContent;
    const previous = [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === "上個月")!;
    await act(async () => previous.click());
    expect(host.querySelector("h1")!.textContent).toBe(before);
    expect(host.textContent).toContain("月份切換失敗");
    expect(host.textContent).not.toContain("沒有可切換的月份");
    expect(previous.disabled).toBe(false);
    failing = false;
    await act(async () => previous.click());
    expect(host.querySelector("h1")!.textContent).toContain("2025");
    expect(host.querySelector("h1")!.textContent).toContain("6");
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); globalThis.IS_REACT_ACT_ENVIRONMENT = false; }
});
