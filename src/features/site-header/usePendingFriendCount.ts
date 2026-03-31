"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

  const refreshPendingFriendCount = useCallback(async () => {
    const response = await fetch("/api/friends/summary", { cache: "no-store" });
    if (!response.ok) {
      setPendingFriendCount(0);
      const changed = friendGraphSignatureRef.current !== "";
      friendGraphSignatureRef.current = "";
      return changed;
    }
    const data = (await response.json()) as {
      incoming?: Array<{ id?: string; fromUserId?: string }>;
      outgoing?: Array<{ id?: string; toUserId?: string }>;
      friends?: Array<{ friendId?: string }>;
    };
    const incoming = Array.isArray(data.incoming) ? data.incoming : [];
    const outgoing = Array.isArray(data.outgoing) ? data.outgoing : [];
    const friends = Array.isArray(data.friends) ? data.friends : [];
    const nextSignature = JSON.stringify({
      incoming: incoming.map((row) => `${row.id ?? ""}:${row.fromUserId ?? ""}`),
      outgoing: outgoing.map((row) => `${row.id ?? ""}:${row.toUserId ?? ""}`),
      friends: friends.map((row) => row.friendId ?? ""),
    });
    const changed = friendGraphSignatureRef.current !== nextSignature;
    friendGraphSignatureRef.current = nextSignature;
    setPendingFriendCount(incoming.length);
    return changed;
  }, []);

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
