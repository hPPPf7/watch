"use client";

import { useEffect, useState } from "react";

type UsePageActivityStateOptions = {
  enabled?: boolean;
  idleMs?: number;
};

const DEFAULT_IDLE_MS = 3 * 60 * 1000;

export default function usePageActivityState({
  enabled = true,
  idleMs = DEFAULT_IDLE_MS,
}: UsePageActivityStateOptions = {}) {
  const [inactive, setInactive] = useState(() => {
    if (typeof document === "undefined") return false;
    return document.visibilityState !== "visible";
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
        if (document.visibilityState === "visible") {
          setInactive(true);
        }
      }, idleMs);
    };

    const markActive = () => {
      if (document.visibilityState !== "visible") return;
      setInactive(false);
      scheduleIdleTimer();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clearIdleTimer();
        setInactive(true);
        return;
      }
      markActive();
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "focus",
    ];

    document.addEventListener("visibilitychange", handleVisibilityChange);
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, markActive, { passive: true });
    });

    queueMicrotask(() => {
      if (typeof document === "undefined") {
        markActive();
      } else if (document.visibilityState === "visible") {
        markActive();
      } else {
        clearIdleTimer();
        setInactive(true);
      }
    });

    return () => {
      clearIdleTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, markActive);
      });
    };
  }, [enabled, idleMs]);

  return enabled ? inactive : false;
}
