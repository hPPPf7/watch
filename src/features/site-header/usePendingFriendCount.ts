"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import useAccountFetch from "@/hooks/useAccountFetch";
import type { LegacySession } from "@/types/auth";
import useFriendNoticeRealtimeRefresh from "@/hooks/useFriendNoticeRealtimeRefresh";
import { FRIEND_NOTICE_REFRESH_EVENT } from "@/lib/friendNoticeEvents";

type UsePendingFriendCountParams = {
  session: LegacySession | null;
  sessionLoading: boolean;
};

export default function usePendingFriendCount({
  session,
  sessionLoading,
}: UsePendingFriendCountParams) {
  const [pendingFriendCount, setPendingFriendCount] = useState(0);
  const friendGraphSignatureRef = useRef("");
  const requestIdRef = useRef(0);
  const fetch = useAccountFetch();
  useLayoutEffect(() => () => { requestIdRef.current += 1; }, [session?.user.id]);

  const refreshPendingFriendCount = useCallback(async () => {
    if (!session || sessionLoading) return false;
    const requestId = ++requestIdRef.current;
    try {
      const response = await fetch("/api/friends/summary", { cache: "no-store" });
      if (!response.ok) return false;
      const data = (await response.json()) as {
        incoming?: Array<{ id: string; fromUserId: string }>;
        outgoing?: Array<{ id: string; toUserId: string }>;
        friends?: Array<{ friendId: string }>;
      } | null;
      if (!data || !Array.isArray(data.incoming) || !Array.isArray(data.outgoing) || !Array.isArray(data.friends) ||
        data.incoming.some(row => !row || typeof row.id !== "string" || typeof row.fromUserId !== "string") ||
        data.outgoing.some(row => !row || typeof row.id !== "string" || typeof row.toUserId !== "string") ||
        data.friends.some(row => !row || typeof row.friendId !== "string")) return false;
      if (requestId !== requestIdRef.current) return false;
      const nextSignature = JSON.stringify({
        incoming: data.incoming.map(row => `${row.id}:${row.fromUserId}`),
        outgoing: data.outgoing.map(row => `${row.id}:${row.toUserId}`),
        friends: data.friends.map(row => row.friendId),
      });
      const changed = friendGraphSignatureRef.current !== nextSignature;
      friendGraphSignatureRef.current = nextSignature;
      setPendingFriendCount(data.incoming.length);
      return changed;
    } catch {
      // Aborted, failed and malformed reads preserve the last successful graph.
      return false;
    }
  }, [fetch, session, sessionLoading]);

  useEffect(() => {
    if (sessionLoading) return;
    if (session) return;
    queueMicrotask(() => {
      setPendingFriendCount(0);
      friendGraphSignatureRef.current = "";
    });
  }, [session, sessionLoading]);

  useFriendNoticeRealtimeRefresh(refreshPendingFriendCount, {
    enabled: Boolean(session) && !sessionLoading,
    runOnMount: true,
    fallbackIntervalMs: 60 * 1000,
    connectedIntervalMs: null,
    pauseWhenHidden: true,
  });

  useEffect(() => {
    if (!session || sessionLoading) return;

    const handleRefresh = () => {
      void refreshPendingFriendCount();
    };

    window.addEventListener(FRIEND_NOTICE_REFRESH_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(FRIEND_NOTICE_REFRESH_EVENT, handleRefresh);
    };
  }, [refreshPendingFriendCount, session, sessionLoading]);

  return pendingFriendCount;
}
