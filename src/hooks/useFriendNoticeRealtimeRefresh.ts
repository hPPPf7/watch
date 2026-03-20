"use client";

import { useEffect, useRef } from "react";

type UseFriendNoticeRealtimeRefreshOptions = {
  enabled?: boolean;
  runOnMount?: boolean;
  fallbackIntervalMs?: number;
  connectedIntervalMs?: number;
  pauseWhenHidden?: boolean;
};

export default function useFriendNoticeRealtimeRefresh(
  refresh: () => Promise<void>,
  {
    enabled = true,
    runOnMount = true,
    fallbackIntervalMs = 20 * 1000,
    connectedIntervalMs = 5 * 60 * 1000,
    pauseWhenHidden = false,
  }: UseFriendNoticeRealtimeRefreshOptions = {},
) {
  const refreshRef = useRef(refresh);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let eventSource: EventSource | null = null;
    let refreshIntervalId: number | null = null;
    let availabilityRetryTimeoutId: number | null = null;
    let availabilityCheck: Promise<void> | null = null;
    let hiddenRefreshPending = false;
    const isDocumentHidden = () =>
      pauseWhenHidden &&
      typeof document !== "undefined" &&
      document.visibilityState === "hidden";

    const runRefresh = async () => {
      if (cancelled) return;
      if (isDocumentHidden()) {
        hiddenRefreshPending = true;
        return;
      }
      if (inFlightRef.current) {
        pendingRef.current = true;
        return;
      }

      inFlightRef.current = true;
      try {
        await refreshRef.current();
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

    if (runOnMount) {
      void runRefresh();
    }

    startRefreshInterval(fallbackIntervalMs);

    if (typeof EventSource === "undefined") {
      return () => {
        cancelled = true;
        stopFallbackPolling();
      };
    }

    const connect = () => {
      if (cancelled) return;
      eventSource = new EventSource("/api/events/friends/stream");
      eventSource.onopen = () => {
        clearAvailabilityRetry();
        startRefreshInterval(connectedIntervalMs);
      };
      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { type?: string };
          if (payload.type !== "friend_notice_update") return;
        } catch {
          return;
        }
        void runRefresh();
      };
      eventSource.onerror = () => {
        startRefreshInterval(fallbackIntervalMs);
      };
    };

    const handleVisibilityChange = () => {
      if (cancelled || !pauseWhenHidden) return;
      if (document.visibilityState !== "visible") return;
      if (!hiddenRefreshPending) return;
      hiddenRefreshPending = false;
      void runRefresh();
    };

    if (pauseWhenHidden && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    const checkAvailability = async () => {
      availabilityCheck = fetch("/api/events/friends/stream", {
        method: "HEAD",
        cache: "no-store",
      })
        .then((response) => {
          if (cancelled) return;
          if (!response.ok) {
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
      if (pauseWhenHidden && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      void availabilityCheck;
    };
  }, [
    connectedIntervalMs,
    enabled,
    fallbackIntervalMs,
    pauseWhenHidden,
    runOnMount,
  ]);
}
