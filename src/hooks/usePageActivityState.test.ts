// @vitest-environment jsdom

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import usePageActivityState from "@/hooks/usePageActivityState";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function createVisibilityStateController(initial: DocumentVisibilityState) {
  let current = initial;

  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => current,
  });

  return {
    set(next: DocumentVisibilityState) {
      current = next;
      document.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

describe("usePageActivityState", () => {
  let root: Root | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    vi.useRealTimers();
    delete window.__WATCH_DESKTOP_FOCUSED__;
    document.body.innerHTML = "";
    root = null;
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("starts inactive when tracking is enabled in a hidden document", async () => {
    const visibility = createVisibilityStateController("hidden");
    let latestInactive = false;

    function Test({
      enabled,
      onChange,
    }: {
      enabled: boolean;
      onChange: (inactive: boolean) => void;
    }) {
      const inactive = usePageActivityState({ enabled, idleMs: 1_000 });

      useEffect(() => {
        onChange(inactive);
      }, [inactive, onChange]);

      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(
        createElement(Test, {
          enabled: false,
          onChange: (inactive: boolean) => {
            latestInactive = inactive;
          },
        }),
      );
    });
    expect(latestInactive).toBe(false);

    await act(async () => {
      root!.render(
        createElement(Test, {
          enabled: true,
          onChange: (inactive: boolean) => {
            latestInactive = inactive;
          },
        }),
      );
      await Promise.resolve();
    });

    expect(latestInactive).toBe(true);

    await act(async () => {
      visibility.set("visible");
      await Promise.resolve();
    });
    expect(latestInactive).toBe(false);
  });

  it("becomes inactive after idle and resumes on user activity", async () => {
    createVisibilityStateController("visible");
    let latestInactive = false;

    function Test({ onChange }: { onChange: (inactive: boolean) => void }) {
      const inactive = usePageActivityState({ idleMs: 1_000 });

      useEffect(() => {
        onChange(inactive);
      }, [inactive, onChange]);

      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(
        createElement(Test, {
          onChange: (inactive: boolean) => {
            latestInactive = inactive;
          },
        }),
      );
      await Promise.resolve();
    });

    expect(latestInactive).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(latestInactive).toBe(true);

    await act(async () => {
      window.dispatchEvent(new FocusEvent("focus"));
    });
    expect(latestInactive).toBe(true);

    await act(async () => {
      window.dispatchEvent(new MouseEvent("mousemove"));
    });
    expect(latestInactive).toBe(true);

    await act(async () => {
      window.dispatchEvent(new MouseEvent("mousedown"));
    });
    expect(latestInactive).toBe(false);
  });

  it("only treats editable keyboard input and in-window wheel as activity", async () => {
    createVisibilityStateController("visible");
    let latestInactive = false;

    function Test({ onChange }: { onChange: (inactive: boolean) => void }) {
      const inactive = usePageActivityState({ idleMs: 1_000 });

      useEffect(() => {
        onChange(inactive);
      }, [inactive, onChange]);

      return null;
    }

    const container = document.createElement("div");
    const input = document.createElement("input");
    document.body.appendChild(container);
    document.body.appendChild(input);
    root = createRoot(container);

    await act(async () => {
      root!.render(
        createElement(Test, {
          onChange: (inactive: boolean) => {
            latestInactive = inactive;
          },
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(latestInactive).toBe(true);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    });
    expect(latestInactive).toBe(true);

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    });
    expect(latestInactive).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(latestInactive).toBe(true);

    await act(async () => {
      window.dispatchEvent(new Event("wheel"));
    });
    expect(latestInactive).toBe(false);
  });

  it("treats an unfocused desktop window as inactive", async () => {
    createVisibilityStateController("visible");
    let latestInactive = false;

    function Test({ onChange }: { onChange: (inactive: boolean) => void }) {
      const inactive = usePageActivityState({ idleMs: 1_000 });

      useEffect(() => {
        onChange(inactive);
      }, [inactive, onChange]);

      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(
        createElement(Test, {
          onChange: (inactive: boolean) => {
            latestInactive = inactive;
          },
        }),
      );
      await Promise.resolve();
    });
    expect(latestInactive).toBe(false);

    await act(async () => {
      window.__WATCH_DESKTOP_FOCUSED__ = false;
      window.dispatchEvent(new CustomEvent("watch-desktop-focus-change"));
      await Promise.resolve();
    });
    expect(latestInactive).toBe(true);

    await act(async () => {
      window.__WATCH_DESKTOP_FOCUSED__ = true;
      window.dispatchEvent(new CustomEvent("watch-desktop-focus-change"));
      await Promise.resolve();
    });
    expect(latestInactive).toBe(true);

    await act(async () => {
      window.dispatchEvent(new MouseEvent("mousedown"));
    });
    expect(latestInactive).toBe(false);
  });
});
