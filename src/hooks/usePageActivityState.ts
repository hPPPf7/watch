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

    // 只在分頁「變成隱藏」時把狀態標記為離開；分頁「變回可見」這一側刻意
    // 不處理（早退），所以命名只講 hide、不叫通用的 ActivityStateChange，
    // 避免日後有人以為它也該在可見時 markActive 而把「可見不算回來」還原掉。
    const markInactiveOnHide = () => {
      // 分頁變成隱藏 → 標記離開（讓 SSE / 輪詢 / 補查可以暫停）。
      // 分頁重新變可見，本身不算「回來」：維持離開狀態，直到使用者真的有
      // 動作（mousedown / wheel / touchstart / 於輸入元件按鍵）才由 markActive
      // 恢復。這樣純用鍵盤切回分頁、或視窗被叫到前景卻沒操作，都不會觸發任何
      // 補查 / 重連，跟桌面版視窗 focus 一律要等真實動作的處理保持一致。
      if (!isPageInactive()) return;
      clearIdleTimer();
      setInactive(true);
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

    document.addEventListener("visibilitychange", markInactiveOnHide);
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
      document.removeEventListener("visibilitychange", markInactiveOnHide);
      window.removeEventListener(DESKTOP_FOCUS_EVENT, handleDesktopFocusChange);
      window.removeEventListener("keydown", handleKeyDown);
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, markActive);
      });
    };
  }, [enabled, idleMs]);

  return enabled ? inactive : false;
}
