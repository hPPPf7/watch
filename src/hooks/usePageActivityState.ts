"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    __WATCH_DESKTOP_FOCUSED__?: boolean;
  }
}

type UsePageActivityStateOptions = {
  enabled?: boolean;
  idleMs?: number;
};

const DEFAULT_IDLE_MS = 3 * 60 * 1000;
const DESKTOP_FOCUS_EVENT = "watch-desktop-focus-change";

const isPageInactive = () => {
  if (typeof document === "undefined") return false;
  return (
    document.visibilityState !== "visible" ||
    (typeof window !== "undefined" && window.__WATCH_DESKTOP_FOCUSED__ === false)
  );
};

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
};

export default function usePageActivityState({
  enabled = true,
  idleMs = DEFAULT_IDLE_MS,
}: UsePageActivityStateOptions = {}) {
  const [inactive, setInactive] = useState(() => {
    return isPageInactive();
  });

  useEffect(() => {
    if (!enabled) return;

    let timer: number | null = null;

    const clearIdleTimer = () => {
      if (timer === null) return;
      window.clearTimeout(timer);
      timer = null;
    };

    const scheduleIdleTimer = () => {
      clearIdleTimer();
      timer = window.setTimeout(() => {
        if (!isPageInactive()) {
          setInactive(true);
        }
      }, idleMs);
    };

    const markActive = () => {
      if (isPageInactive()) return;
      setInactive(false);
      scheduleIdleTimer();
    };

    const handleActivityStateChange = () => {
      if (isPageInactive()) {
        clearIdleTimer();
        setInactive(true);
        return;
      }
      markActive();
    };

    const handleDesktopFocusChange = () => {
      if (window.__WATCH_DESKTOP_FOCUSED__ === false) {
        clearIdleTimer();
        setInactive(true);
      }
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      "mousedown",
      "wheel",
      "touchstart",
    ];

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isEditableTarget(event.target)) return;
      markActive();
    };

    document.addEventListener("visibilitychange", handleActivityStateChange);
    window.addEventListener(DESKTOP_FOCUS_EVENT, handleDesktopFocusChange);
    window.addEventListener("keydown", handleKeyDown);
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, markActive, { passive: true });
    });

    queueMicrotask(() => {
      if (isPageInactive()) {
        clearIdleTimer();
        setInactive(true);
      } else {
        markActive();
      }
    });

    return () => {
      clearIdleTimer();
      document.removeEventListener("visibilitychange", handleActivityStateChange);
      window.removeEventListener(DESKTOP_FOCUS_EVENT, handleDesktopFocusChange);
      window.removeEventListener("keydown", handleKeyDown);
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, markActive);
      });
    };
  }, [enabled, idleMs]);

  return enabled ? inactive : false;
}
