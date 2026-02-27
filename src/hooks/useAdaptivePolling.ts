"use client";

import { useEffect, useRef } from "react";

type UseAdaptivePollingOptions = {
  enabled?: boolean;
  intervalMs: number;
  runOnMount?: boolean;
  pauseWhenHidden?: boolean;
  backoffMultiplier?: number;
  maxIntervalMs?: number;
};

export default function useAdaptivePolling(
  task: () => Promise<void>,
  {
    enabled = true,
    intervalMs,
    runOnMount = true,
    pauseWhenHidden = true,
    backoffMultiplier = 2,
    maxIntervalMs = intervalMs * 6,
  }: UseAdaptivePollingOptions,
) {
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let inFlight = false;
    let timer: number | null = null;
    let nextDelay = intervalMs;

    const schedule = (delay: number) => {
      if (cancelled) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(runTask, delay);
    };

    const runTask = async () => {
      if (cancelled) return;
      if (pauseWhenHidden && document.visibilityState !== "visible") {
        schedule(intervalMs);
        return;
      }
      if (inFlight) {
        schedule(nextDelay);
        return;
      }

      inFlight = true;
      try {
        await taskRef.current();
        nextDelay = intervalMs;
      } catch {
        nextDelay = Math.min(
          Math.round(nextDelay * backoffMultiplier),
          maxIntervalMs,
        );
      } finally {
        inFlight = false;
        schedule(nextDelay);
      }
    };

    const onVisibilityChange = () => {
      if (cancelled || !pauseWhenHidden) return;
      if (document.visibilityState !== "visible") return;
      nextDelay = intervalMs;
      schedule(0);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule(runOnMount ? 0 : intervalMs);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [
    enabled,
    intervalMs,
    runOnMount,
    pauseWhenHidden,
    backoffMultiplier,
    maxIntervalMs,
  ]);
}

