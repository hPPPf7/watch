// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/hooks/useWatchRealtimeRefresh", () => ({ default: () => {} }));
import useHomeWatchStatus from "./useHomeWatchStatus";
const movies = [{ data: [{ id: 1 }] }];
const empty: typeof movies = [];
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
function Harness({ user = "one" }: { user?: string }) {
  const state = useHomeWatchStatus({ session: { user: { id: user } }, sessionLoading: false, movieLists: movies, tvLists: empty, animeLists: empty });
  return <><output>{JSON.stringify(state.watchStatusMap)}</output><span role="alert">{state.watchStatusError}</span><button onClick={() => void state.refreshWatchStatus()}>refresh</button></>;
}
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); globalThis.IS_REACT_ACT_ENVIRONMENT = false; });
const refresh = () => act(async () => host.querySelector("button")!.click());
it("retains a successful badge on HTTP and network failure, and recovers manually", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ statusMap: { "movie:series:1": "completed" } })).mockResolvedValueOnce(new Response(null, { status: 503 })).mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(Response.json({ statusMap: {} }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<Harness />));
  await refresh();
  await refresh();
  expect(host.querySelector("output")!.textContent).toContain("completed");
  expect(host.querySelector('[role="alert"]')!.textContent).toContain("讀取失敗");
  await refresh();
  expect(host.querySelector("output")!.textContent).toContain("completed");
  await refresh();
  expect(host.querySelector("output")!.textContent).toBe("{}");
  expect(host.querySelector('[role="alert"]')!.textContent).toBe("");
});
it("rejects a late successful read after a newer refresh and an account remount", async () => {
  let resolveOld!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; })).mockResolvedValue(Response.json({ statusMap: { "movie:series:1": "watching" } }));
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<Harness />));
  await refresh();
  await refresh();
  await act(async () => resolveOld(Response.json({ statusMap: { "movie:series:1": "completed" } })));
  expect(host.querySelector("output")!.textContent).toContain("watching");
  fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; }));
  await refresh();
  await act(async () => root.render(<Harness key="two" user="two" />));
  expect(host.querySelector("output")!.textContent).toBe("{}");
  await act(async () => resolveOld(Response.json({ statusMap: { "movie:series:1": "completed" } })));
  expect(host.querySelector("output")!.textContent).toBe("{}");
});
