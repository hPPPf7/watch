"use client";

import { useEffect, useRef } from "react";
import usePageActivityState from "@/hooks/usePageActivityState";

export type WatchRealtimeRefreshTrigger = {
  source: "mount" | "interval" | "event" | "visibility";
  reason?: string;
};

type UseWatchRealtimeRefreshOptions = {
  enabled?: boolean;
  runOnMount?: boolean;
  fallbackIntervalMs?: number;
  connectedIntervalMs?: number | null;
  pauseWhenHidden?: boolean;
};

export default function useWatchRealtimeRefresh(
  refresh: (trigger: WatchRealtimeRefreshTrigger) => Promise<void>,
  {
    enabled = true,
    runOnMount = true,
    fallbackIntervalMs = 5 * 60 * 1000,
    connectedIntervalMs = null,
    pauseWhenHidden = false,
  }: UseWatchRealtimeRefreshOptions = {},
) {
  const refreshRef = useRef(refresh);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const pendingTriggerRef = useRef<WatchRealtimeRefreshTrigger | null>(null);
  const previousPageInactiveRef = useRef(false);
  const wasUsingRealtimeBeforeInactiveRef = useRef(false);
  const lastWatchEventKeyRef = useRef<string | null>(null);
  const pageInactive = usePageActivityState({
    enabled: enabled && pauseWhenHidden,
  });
  refreshRef.current = refresh;

  useEffect(() => {
    const resumedFromInactive = previousPageInactiveRef.current && !pageInactive;
    previousPageInactiveRef.current = pageInactive;

    if (!enabled || pageInactive) return;

    let cancelled = false;
    let eventSource: EventSource | null = null;
    let refreshIntervalId: number | null = null;
    const hasEventSource = typeof EventSource !== "undefined";
    const skipResumeRefreshForRealtime =
      resumedFromInactive && hasEventSource && wasUsingRealtimeBeforeInactiveRef.current;
    let didFallbackRefreshAfterResume = false;

    const runRefresh = async (trigger: WatchRealtimeRefreshTrigger) => {
      if (cancelled) return;
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

    if (
      (!resumedFromInactive && runOnMount) ||
      (resumedFromInactive && !skipResumeRefreshForRealtime)
    ) {
      void runRefresh({
        source: resumedFromInactive ? "visibility" : "mount",
      });
    }

    startRefreshInterval(fallbackIntervalMs);

    if (!hasEventSource) {
      return () => {
        cancelled = true;
        stopFallbackPolling();
      };
    }

    eventSource = new EventSource("/api/events/watchlist/stream");
    eventSource.onopen = () => {
      wasUsingRealtimeBeforeInactiveRef.current = true;
      if (!skipResumeRefreshForRealtime) {
        void runRefresh({ source: "visibility", reason: "reconnect" });
      }
      if (connectedIntervalMs === null) {
        stopFallbackPolling();
        return;
      }
      startRefreshInterval(connectedIntervalMs);
    };
    eventSource.onmessage = (event) => {
      let payload: { type?: string; reason?: string; at?: number } | null = null;
      try {
        payload = JSON.parse(event.data) as {
          type?: string;
          reason?: string;
          at?: number;
        };
        if (payload.type !== "watchlist_update") return;
      } catch {
        return;
      }
      const eventKey =
        typeof payload.at === "number"
          ? `${payload.reason ?? "unknown"}:${payload.at}`
          : null;
      if (eventKey && eventKey === lastWatchEventKeyRef.current) {
        return;
      }
      lastWatchEventKeyRef.current = eventKey;
      void runRefresh({ source: "event", reason: payload?.reason });
    };
    eventSource.onerror = () => {
      wasUsingRealtimeBeforeInactiveRef.current = false;
      if (
        resumedFromInactive &&
        skipResumeRefreshForRealtime &&
        !didFallbackRefreshAfterResume
      ) {
        didFallbackRefreshAfterResume = true;
        void runRefresh({ source: "visibility", reason: "fallback" });
      }
      startRefreshInterval(fallbackIntervalMs);
    };

    return () => {
      cancelled = true;
      stopFallbackPolling();
      eventSource?.close();
    };
  }, [
    connectedIntervalMs,
    enabled,
    fallbackIntervalMs,
    pageInactive,
    pauseWhenHidden,
    runOnMount,
  ]);
}
