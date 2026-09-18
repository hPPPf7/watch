// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ inactive: false }));
vi.mock("@/hooks/usePageActivityState", () => ({ default: () => state.inactive }));
import useWatchRealtimeRefresh, { type WatchRealtimeRefreshTrigger } from "@/hooks/useWatchRealtimeRefresh";

class Events {
  static instances: Events[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { Events.instances.push(this); }
  close = vi.fn();
}

type Refresh = (trigger: WatchRealtimeRefreshTrigger) => Promise<void>;
let root: ReturnType<typeof createRoot>;
function Test({ refresh, paused = false, runOnMount = false }: {
  refresh: Refresh;
  paused?: boolean;
  runOnMount?: boolean;
}) {
  useWatchRealtimeRefresh(refresh, { paused, runOnMount, pauseWhenHidden: true, fallbackIntervalMs: 1000 });
  return null;
}
const render = (refresh: Refresh, paused = false, runOnMount = false) => act(async () => {
  root.render(createElement(Test, { refresh, paused, runOnMount }));
});
const emitUpdate = (at: number, reason = "history") => {
  Events.instances.at(-1)!.onmessage?.({ data: JSON.stringify({ type: "watchlist_update", reason, at }) });
};

beforeEach(() => {
  state.inactive = false;
  Events.instances = [];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", Events);
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
});

it.each(["after resume", "before pause", "finish inactive"])("preserves a queued update: %s", async timing => {
  let resolveOld!: () => void;
  const old = new Promise<void>(resolve => { resolveOld = resolve; });
  const refresh = vi.fn<Refresh>().mockReturnValueOnce(old).mockResolvedValue(undefined);
  await render(refresh, false, true);
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => Events.instances[0].onopen?.());
  if (timing !== "after resume") await act(async () => emitUpdate(100));
  state.inactive = true;
  await render(refresh, false, true);
  if (timing === "finish inactive") await act(async () => { resolveOld(); await Promise.resolve(); });
  state.inactive = false;
  await render(refresh, false, true);
  await act(async () => { Events.instances.at(-1)!.onopen?.(); emitUpdate(100); });
  await act(async () => { resolveOld(); await Promise.resolve(); });
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("pause and resume without an update keeps the connection and does not refresh", async () => {
  const refresh = vi.fn<Refresh>().mockResolvedValue(undefined);
  await render(refresh);
  const connection = Events.instances[0];
  await act(async () => connection.onopen?.());
  expect(refresh).toHaveBeenCalledTimes(1);
  refresh.mockClear();

  await render(refresh, true);
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  await render(refresh);
  await render(refresh, true);
  await render(refresh);

  expect(Events.instances).toHaveLength(1);
  expect(connection.close).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});

it("coalesces real events during editing and delivers the latest once after resume", async () => {
  const refresh = vi.fn<Refresh>().mockResolvedValue(undefined);
  await render(refresh);
  await act(async () => Events.instances[0].onopen?.());
  refresh.mockClear();

  await render(refresh, true);
  await act(async () => { emitUpdate(100); emitUpdate(101); emitUpdate(102, "history_upsert"); });
  expect(refresh).not.toHaveBeenCalled();
  await render(refresh);
  expect(refresh).toHaveBeenCalledExactlyOnceWith({ source: "event", reason: "history_upsert" });
  await act(async () => emitUpdate(102, "history_upsert"));
  await render(refresh, true);
  await render(refresh);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(Events.instances).toHaveLength(1);
});

it.each(["while paused", "after resume"])("retains a deferred event when an in-flight request finishes %s", async timing => {
  const refresh = vi.fn<Refresh>().mockResolvedValue(undefined);
  await render(refresh);
  await act(async () => Events.instances[0].onopen?.());
  refresh.mockClear();
  let resolveOld!: () => void;
  const old = new Promise<void>(resolve => { resolveOld = resolve; });
  refresh.mockReturnValueOnce(old);
  await act(async () => emitUpdate(100));
  expect(refresh).toHaveBeenCalledTimes(1);

  await render(refresh, true);
  await act(async () => { emitUpdate(101); emitUpdate(102); });
  if (timing === "while paused") {
    await act(async () => { resolveOld(); await Promise.resolve(); });
    expect(refresh).toHaveBeenCalledTimes(1);
  }
  await render(refresh);
  if (timing === "after resume") {
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => { resolveOld(); await Promise.resolve(); });
  }
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(Events.instances).toHaveLength(1);
});

it("defers disconnected fallback polling during editing and resumes normal polling", async () => {
  vi.stubGlobal("EventSource", undefined);
  const refresh = vi.fn<Refresh>().mockResolvedValue(undefined);
  await render(refresh, true);
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(refresh).not.toHaveBeenCalled();

  await render(refresh);
  expect(refresh).toHaveBeenCalledExactlyOnceWith({ source: "interval" });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("defers reconnect and fallback triggers during editing, then stops connected polling", async () => {
  const refresh = vi.fn<Refresh>().mockResolvedValue(undefined);
  await render(refresh);
  const connection = Events.instances[0];
  await act(async () => connection.onopen?.());
  refresh.mockClear();
  await render(refresh, true);
  await act(async () => connection.onerror?.());
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  await act(async () => connection.onopen?.());
  expect(refresh).not.toHaveBeenCalled();

  await render(refresh);
  expect(refresh).toHaveBeenCalledExactlyOnceWith({ source: "visibility", reason: "reconnect" });
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(connection.close).not.toHaveBeenCalled();
});

it("keeps deferred editor events until the page also becomes active", async () => {
  const refresh = vi.fn<Refresh>().mockResolvedValue(undefined);
  await render(refresh);
  await act(async () => Events.instances[0].onopen?.());
  refresh.mockClear();
  await render(refresh, true);
  await act(async () => emitUpdate(100));
  state.inactive = true;
  await render(refresh, true);
  await render(refresh);
  expect(refresh).not.toHaveBeenCalled();

  state.inactive = false;
  await render(refresh);
  await act(async () => { Events.instances.at(-1)!.onopen?.(); emitUpdate(100); });
  expect(refresh).toHaveBeenCalledExactlyOnceWith({ source: "event", reason: "history" });
});
