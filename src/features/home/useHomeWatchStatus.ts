"use client";

import { useCallback, useEffect, useState } from "react";
import type { LegacySession } from "@/types/auth";
import useAdaptivePolling from "@/hooks/useAdaptivePolling";
import { WATCH_STATUS_REFRESH_EVENT } from "@/lib/watchStatusEvents";

type ListWithIds = {
  data: Array<{ id: number }>;
};

type UseHomeWatchStatusParams = {
  session: LegacySession | null;
  sessionLoading: boolean;
  movieLists: ListWithIds[];
  tvLists: ListWithIds[];
  animeLists: ListWithIds[];
};

export default function useHomeWatchStatus({
  session,
  sessionLoading,
  movieLists,
  tvLists,
  animeLists,
}: UseHomeWatchStatusParams) {
  const [watchStatusMap, setWatchStatusMap] = useState<
    Record<string, "completed" | "watching">
  >({});

  const refreshWatchStatus = useCallback(async () => {
    if (!session || sessionLoading) {
      setWatchStatusMap({});
      return;
    }

    const movieIds = new Set<number>();
    const tvIds = new Set<number>();
    const animeIds = new Set<number>();

    movieLists.forEach((list) => list.data.forEach((item) => movieIds.add(item.id)));
    tvLists.forEach((list) => list.data.forEach((item) => tvIds.add(item.id)));
    animeLists.forEach((list) => list.data.forEach((item) => animeIds.add(item.id)));

    const response = await fetch("/api/home/watch-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        movieIds: Array.from(movieIds),
        tvIds: Array.from(tvIds),
        animeIds: Array.from(animeIds),
      }),
    });

    if (!response.ok) {
      setWatchStatusMap({});
      return;
    }

    const data = (await response.json()) as {
      statusMap?: Record<string, "completed" | "watching">;
    };
    setWatchStatusMap(data.statusMap ?? {});
  }, [animeLists, movieLists, session, sessionLoading, tvLists]);

  useEffect(() => {
    if (sessionLoading) return;
    if (session) return;
    queueMicrotask(() => {
      setWatchStatusMap({});
    });
  }, [session, sessionLoading]);

  useAdaptivePolling(refreshWatchStatus, {
    enabled: Boolean(session) && !sessionLoading,
    intervalMs: 20000,
    runOnMount: true,
    pauseWhenHidden: true,
    maxIntervalMs: 120000,
  });

  useEffect(() => {
    if (!session || sessionLoading) return;
    const handleRefresh = () => {
      void refreshWatchStatus();
    };
    window.addEventListener(WATCH_STATUS_REFRESH_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(WATCH_STATUS_REFRESH_EVENT, handleRefresh);
    };
  }, [refreshWatchStatus, session, sessionLoading]);

  return { watchStatusMap, refreshWatchStatus };
}
