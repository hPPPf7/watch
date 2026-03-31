// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useFriendNoticeRealtimeRefresh from "@/hooks/useFriendNoticeRealtimeRefresh";
import { dispatchFriendGraphRefresh } from "@/lib/friendNoticeEvents";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

vi.mock("@/hooks/usePageActivityState", () => ({
  default: vi.fn(() => false),
}));

vi.mock("@/lib/friendNoticeEvents", () => ({
  dispatchFriendGraphRefresh: vi.fn(),
}));

class MockEventSource {
  static instances: MockEventSource[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  close() {}
}

describe("useFriendNoticeRealtimeRefresh", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
      }),
    );
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.useRealTimers();
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  function renderHook(
    refresh: () => Promise<boolean | void>,
    options?: Parameters<typeof useFriendNoticeRealtimeRefresh>[1],
  ) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    function Test() {
      useFriendNoticeRealtimeRefresh(refresh, options);
      return null;
    }

    act(() => {
      root.render(createElement(Test));
    });
  }

  it("does not invalidate friend graph when refresh reports no change", async () => {
    const refresh = vi.fn().mockResolvedValue(false);

    renderHook(refresh, {
      runOnMount: true,
      fallbackIntervalMs: 60_000,
      connectedIntervalMs: null,
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(dispatchFriendGraphRefresh).not.toHaveBeenCalled();

    await act(async () => {
      MockEventSource.instances[0]?.onopen?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(dispatchFriendGraphRefresh).not.toHaveBeenCalled();
  });

  it("invalidates friend graph when refresh reports a change", async () => {
    const refresh = vi.fn().mockResolvedValue(true);

    renderHook(refresh, {
      runOnMount: true,
      fallbackIntervalMs: 60_000,
      connectedIntervalMs: null,
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(dispatchFriendGraphRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      MockEventSource.instances[0]?.onopen?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(dispatchFriendGraphRefresh).toHaveBeenCalledTimes(2);
  });
});
