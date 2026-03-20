"use client";

import { useEffect, useRef } from "react";

export type WatchRealtimeRefreshTrigger = {
  source: "mount" | "interval" | "event" | "visibility";
  reason?: string;
};

type UseWatchRealtimeRefreshOptions = {
  enabled?: boolean;
  runOnMount?: boolean;
  fallbackIntervalMs?: number;
  connectedIntervalMs?: number;
  pauseWhenHidden?: boolean;
};

export default function useWatchRealtimeRefresh(
  refresh: (trigger: WatchRealtimeRefreshTrigger) => Promise<void>,
  {
    enabled = true,
    runOnMount = true,
    fallbackIntervalMs = 5 * 60 * 1000,
    connectedIntervalMs = 5 * 60 * 1000,
    pauseWhenHidden = false,
  }: UseWatchRealtimeRefreshOptions = {},
) {
  const refreshRef = useRef(refresh);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const pendingTriggerRef = useRef<WatchRealtimeRefreshTrigger | null>(null);
  const hiddenTriggerRef = useRef<WatchRealtimeRefreshTrigger | null>(null);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let eventSource: EventSource | null = null;
    let refreshIntervalId: number | null = null;
    let hiddenRefreshPending = false;
    const isDocumentHidden = () =>
      pauseWhenHidden &&
      typeof document !== "undefined" &&
      document.visibilityState === "hidden";

    const runRefresh = async (trigger: WatchRealtimeRefreshTrigger) => {
      if (cancelled) return;
      if (isDocumentHidden()) {
        hiddenRefreshPending = true;
        hiddenTriggerRef.current = trigger;
        return;
      }
      if (inFlightRef.current) {
        pendingRef.current = true;
        pendingTriggerRef.current = trigger;
        return;
      }

      inFlightRef.current = true;
      try {
        await refreshRef.current(trigger);
      } catch {
        // Swallow transient refresh failures so polling/SSE loops keep running quietly.
      } finally {
        inFlightRef.current = false;
        if (!cancelled && pendingRef.current) {
          const nextTrigger = pendingTriggerRef.current ?? trigger;
          pendingRef.current = false;
          pendingTriggerRef.current = null;
          queueMicrotask(() => {
            void runRefresh(nextTrigger);
          });
        }
      }
    };

    const startRefreshInterval = (intervalMs: number) => {
      if (refreshIntervalId !== null) {
        window.clearInterval(refreshIntervalId);
      }
      refreshIntervalId = window.setInterval(() => {
        void runRefresh({ source: "interval" });
      }, intervalMs);
    };

    const stopFallbackPolling = () => {
      if (refreshIntervalId === null) return;
      window.clearInterval(refreshIntervalId);
      refreshIntervalId = null;
    };

    if (runOnMount) {
      void runRefresh({ source: "mount" });
    }

    startRefreshInterval(fallbackIntervalMs);

    if (typeof EventSource === "undefined") {
      return () => {
        cancelled = true;
        stopFallbackPolling();
      };
    }

    eventSource = new EventSource("/api/events/watchlist/stream");
    eventSource.onopen = () => {
      startRefreshInterval(connectedIntervalMs);
    };
    eventSource.onmessage = (event) => {
      let payload: { type?: string; reason?: string } | null = null;
      try {
        payload = JSON.parse(event.data) as { type?: string; reason?: string };
        if (payload.type !== "watchlist_update") return;
      } catch {
        return;
      }
      void runRefresh({ source: "event", reason: payload?.reason });
    };
    eventSource.onerror = () => {
      startRefreshInterval(fallbackIntervalMs);
    };

    const handleVisibilityChange = () => {
      if (cancelled || !pauseWhenHidden) return;
      if (document.visibilityState !== "visible") return;
      if (!hiddenRefreshPending) return;
      const nextTrigger =
        hiddenTriggerRef.current ?? ({ source: "visibility" } as const);
      hiddenRefreshPending = false;
      hiddenTriggerRef.current = null;
      void runRefresh(nextTrigger);
    };

    if (pauseWhenHidden && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      cancelled = true;
      stopFallbackPolling();
      eventSource?.close();
      if (pauseWhenHidden && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [
    connectedIntervalMs,
    enabled,
    fallbackIntervalMs,
    pauseWhenHidden,
    runOnMount,
  ]);
}
