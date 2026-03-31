"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LegacySession } from "@/types/auth";
import useWatchRealtimeRefresh from "@/hooks/useWatchRealtimeRefresh";
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
  const lastLoadedSignatureRef = useRef<string | null>(null);
  const listSignature = useMemo(() => {
    const movieIds = movieLists.flatMap((list) => list.data.map((item) => item.id));
    const tvIds = tvLists.flatMap((list) => list.data.map((item) => item.id));
    const animeIds = animeLists.flatMap((list) => list.data.map((item) => item.id));
    return JSON.stringify({
      userId: session?.user.id ?? null,
      movieIds,
      tvIds,
      animeIds,
    });
  }, [animeLists, movieLists, session?.user.id, tvLists]);
  const hasAnyListItems = useMemo(
    () =>
      movieLists.some((list) => list.data.length > 0) ||
      tvLists.some((list) => list.data.length > 0) ||
      animeLists.some((list) => list.data.length > 0),
    [animeLists, movieLists, tvLists],
  );

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

  useWatchRealtimeRefresh(refreshWatchStatus, {
    enabled: Boolean(session) && !sessionLoading,
    runOnMount: true,
    fallbackIntervalMs: 60 * 1000,
    connectedIntervalMs: null,
    pauseWhenHidden: true,
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

  useEffect(() => {
    if (!session || sessionLoading) return;
    if (lastLoadedSignatureRef.current === null) {
      lastLoadedSignatureRef.current = listSignature;
      if (hasAnyListItems) {
        return;
      }
    }
    if (lastLoadedSignatureRef.current === listSignature) {
      return;
    }
    lastLoadedSignatureRef.current = listSignature;
    queueMicrotask(() => {
      void refreshWatchStatus();
    });
  }, [hasAnyListItems, listSignature, refreshWatchStatus, session, sessionLoading]);

  return { watchStatusMap, refreshWatchStatus };
}
