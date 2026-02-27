"use client";

import { useCallback, useEffect, useState } from "react";
import type { LegacySession } from "@/types/auth";
import useAdaptivePolling from "@/hooks/useAdaptivePolling";

type UsePendingFriendCountParams = {
  session: LegacySession | null;
  sessionLoading: boolean;
};

export default function usePendingFriendCount({
  session,
  sessionLoading,
}: UsePendingFriendCountParams) {
  const [pendingFriendCount, setPendingFriendCount] = useState(0);

  const refreshPendingFriendCount = useCallback(async () => {
    const response = await fetch("/api/friends/summary", { cache: "no-store" });
    if (!response.ok) {
      setPendingFriendCount(0);
      return;
    }
    const data = (await response.json()) as { incoming?: unknown[] };
    setPendingFriendCount(Array.isArray(data.incoming) ? data.incoming.length : 0);
  }, []);

  useEffect(() => {
    if (sessionLoading) return;
    if (session) return;
    queueMicrotask(() => {
      setPendingFriendCount(0);
    });
  }, [session, sessionLoading]);

  useAdaptivePolling(refreshPendingFriendCount, {
    enabled: Boolean(session) && !sessionLoading,
    intervalMs: 20000,
    runOnMount: true,
    pauseWhenHidden: true,
    maxIntervalMs: 120000,
  });

  return pendingFriendCount;
}
