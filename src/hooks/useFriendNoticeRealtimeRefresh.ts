"use client";

import { useEffect, useRef } from "react";
import usePageActivityState from "@/hooks/usePageActivityState";
import { dispatchFriendGraphRefresh } from "@/lib/friendNoticeEvents";

type UseFriendNoticeRealtimeRefreshOptions = {
  enabled?: boolean;
  runOnMount?: boolean;
  fallbackIntervalMs?: number;
  connectedIntervalMs?: number | null;
  pauseWhenHidden?: boolean;
};

export default function useFriendNoticeRealtimeRefresh(
  refresh: () => Promise<boolean | void>,
  {
    enabled = true,
    runOnMount = true,
    fallbackIntervalMs = 20 * 1000,
    connectedIntervalMs = null,
    pauseWhenHidden = false,
  }: UseFriendNoticeRealtimeRefreshOptions = {},
) {
  const refreshRef = useRef(refresh);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const previousPageInactiveRef = useRef(false);
  const wasUsingRealtimeBeforeInactiveRef = useRef(false);
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
    let availabilityRetryTimeoutId: number | null = null;
    let availabilityCheck: Promise<void> | null = null;
    const hasEventSource = typeof EventSource !== "undefined";
    const skipResumeRefreshForRealtime =
      resumedFromInactive && hasEventSource && wasUsingRealtimeBeforeInactiveRef.current;
    let didFallbackRefreshAfterResume = false;

    const runRefresh = async () => {
      if (cancelled) return;
      if (inFlightRef.current) {
        pendingRef.current = true;
        return;
      }

      inFlightRef.current = true;
      try {
        const shouldInvalidateFriendGraph = await refreshRef.current();
        if (shouldInvalidateFriendGraph) {
          dispatchFriendGraphRefresh();
        }
      } catch {
        // Swallow transient refresh failures so polling/SSE loops keep running quietly.
      } finally {
        inFlightRef.current = false;
        if (!cancelled && pendingRef.current) {
          pendingRef.current = false;
          queueMicrotask(() => {
            void runRefresh();
          });
        }
      }
    };

    const startRefreshInterval = (intervalMs: number) => {
      if (refreshIntervalId !== null) {
        window.clearInterval(refreshIntervalId);
      }
      refreshIntervalId = window.setInterval(() => {
        void runRefresh();
      }, intervalMs);
    };

    const stopFallbackPolling = () => {
      if (refreshIntervalId === null) return;
      window.clearInterval(refreshIntervalId);
      refreshIntervalId = null;
    };

    const clearAvailabilityRetry = () => {
      if (availabilityRetryTimeoutId === null) return;
      window.clearTimeout(availabilityRetryTimeoutId);
      availabilityRetryTimeoutId = null;
    };

    const scheduleAvailabilityRetry = () => {
      if (availabilityRetryTimeoutId !== null || cancelled) return;
      availabilityRetryTimeoutId = window.setTimeout(() => {
        availabilityRetryTimeoutId = null;
        void checkAvailability();
      }, fallbackIntervalMs);
    };

    if (
      (!resumedFromInactive && runOnMount) ||
      (resumedFromInactive && !skipResumeRefreshForRealtime)
    ) {
      void runRefresh();
    }

    startRefreshInterval(fallbackIntervalMs);

    if (!hasEventSource) {
      return () => {
        cancelled = true;
        stopFallbackPolling();
      };
    }

    const connect = () => {
      if (cancelled) return;
      eventSource = new EventSource("/api/events/friends/stream");
      eventSource.onopen = () => {
        wasUsingRealtimeBeforeInactiveRef.current = true;
        clearAvailabilityRetry();
        if (!skipResumeRefreshForRealtime) {
          void runRefresh();
        }
        if (connectedIntervalMs === null) {
          stopFallbackPolling();
          return;
        }
        startRefreshInterval(connectedIntervalMs);
      };
      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { type?: string };
          if (payload.type !== "friend_notice_update") return;
        } catch {
          return;
        }
        dispatchFriendGraphRefresh();
        void runRefresh();
      };
      eventSource.onerror = () => {
        wasUsingRealtimeBeforeInactiveRef.current = false;
        if (
          resumedFromInactive &&
          skipResumeRefreshForRealtime &&
          !didFallbackRefreshAfterResume
        ) {
          didFallbackRefreshAfterResume = true;
          void runRefresh();
        }
        startRefreshInterval(fallbackIntervalMs);
      };
    };

    const checkAvailability = async () => {
      availabilityCheck = fetch("/api/events/friends/stream", {
        method: "HEAD",
        cache: "no-store",
      })
        .then((response) => {
          if (cancelled) return;
          if (!response.ok) {
            wasUsingRealtimeBeforeInactiveRef.current = false;
            startRefreshInterval(fallbackIntervalMs);
            if (response.status >= 500) {
              scheduleAvailabilityRetry();
            }
            return;
          }
          connect();
        })
        .catch(() => {
          if (cancelled) return;
          wasUsingRealtimeBeforeInactiveRef.current = false;
          startRefreshInterval(fallbackIntervalMs);
          scheduleAvailabilityRetry();
        });

      await availabilityCheck;
    };

    void checkAvailability();

    return () => {
      cancelled = true;
      stopFallbackPolling();
      clearAvailabilityRetry();
      eventSource?.close();
      void availabilityCheck;
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
