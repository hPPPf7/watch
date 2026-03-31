"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import RequireAuthGate from "@/components/RequireAuthGate";
import useAuth from "@/hooks/useAuth";
import useFriendNoticeRealtimeRefresh from "@/hooks/useFriendNoticeRealtimeRefresh";
import useProfileNames from "@/hooks/useProfileNames";
import { dispatchFriendNoticeRefresh } from "@/lib/friendNoticeEvents";

type FriendRequest = {
  id: string;
  from_user_id: string;
  from_nickname: string | null;
  created_at: string;
};

type OutgoingRequest = {
  id: string;
  to_user_id: string;
  created_at: string;
};

type FriendEntry = {
  friend_id: string;
  friend_nickname: string | null;
  created_at: string;
};

export default function FriendsPage() {
  const { session, loading: sessionLoading } = useAuth();
  const [uidInput, setUidInput] = useState("");
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<OutgoingRequest[]>(
    [],
  );
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [sendLoading, setSendLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"default" | "error" | "success">(
    "default",
  );
  const [deleteTarget, setDeleteTarget] = useState<FriendEntry | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    tone: "error" | "success" | "default";
    anchor?: { left: number; top: number } | null;
    placement?: "above" | "right";
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const toastAnchorRef = useRef<HTMLElement | null>(null);
  const toastRef = useRef<HTMLDivElement | null>(null);
  const [toastPosition, setToastPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const copyButtonRef = useRef<HTMLButtonElement | null>(null);
  const sendButtonRef = useRef<HTMLButtonElement | null>(null);
  const deleteAnchorRef = useRef<HTMLButtonElement | null>(null);

  const profileNameIds = [
    ...requests.map((request) => request.from_user_id),
    ...friends.map((friend) => friend.friend_id),
  ];
  const profileNames = useProfileNames(profileNameIds);

  const resolveName = (id: string, fallback?: string | null) =>
    profileNames[id]?.nickname || fallback || `使用者-${id.slice(0, 6)}`;
  const resolveAvatarUrl = (id: string) => profileNames[id]?.avatarUrl || null;

  const loadRequestsAndFriends = useCallback(
    async (currentSession: { user: { id: string } }, preserveNotice = false) => {
      if (!preserveNotice) {
        setNotice("");
        setNoticeTone("default");
      }
      const response = await fetch("/api/friends/summary");

      if (!response.ok) {
        setNotice("載入好友資料失敗，請稍後再試。");
        setNoticeTone("error");
        setRequests([]);
        setOutgoingRequests([]);
        setFriends([]);
        return;
      }

      const payload = (await response.json()) as {
        incoming?: Array<{
          id: string;
          fromUserId: string;
          fromNickname: string | null;
          createdAt: string;
        }>;
        outgoing?: Array<{
          id: string;
          toUserId: string;
          createdAt: string;
        }>;
        friends?: Array<{
          friendId: string;
          friendNickname: string | null;
          createdAt: string;
        }>;
      };

      setRequests(
        (payload.incoming ?? []).map((row) => ({
          id: row.id,
          from_user_id: row.fromUserId,
          from_nickname: row.fromNickname,
          created_at: row.createdAt,
        })),
      );
      setOutgoingRequests(
        (payload.outgoing ?? []).map((row) => ({
          id: row.id,
          to_user_id: row.toUserId,
          created_at: row.createdAt,
        })),
      );
      setFriends(
        (payload.friends ?? []).map((row) => ({
          friend_id: row.friendId,
          friend_nickname: row.friendNickname,
          created_at: row.createdAt,
        })),
      );
    },
    [],
  );

  useEffect(() => {
    if (!session || sessionLoading) return;
    queueMicrotask(() => {
      loadRequestsAndFriends(session);
    });
  }, [loadRequestsAndFriends, session, sessionLoading]);

  const refreshRequestsAndFriends = useCallback(async () => {
    if (!session) return;
    await loadRequestsAndFriends(session, true);
  }, [loadRequestsAndFriends, session]);

  useFriendNoticeRealtimeRefresh(refreshRequestsAndFriends, {
    enabled: Boolean(session) && !sessionLoading,
    runOnMount: false,
    fallbackIntervalMs: 60 * 1000,
    connectedIntervalMs: null,
    pauseWhenHidden: true,
  });

  useEffect(
    () => () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!deleteTarget) {
      queueMicrotask(() => {
        setDeleteConfirmText("");
        setDeleteNotice("");
      });
    }
  }, [deleteTarget]);

  useLayoutEffect(() => {
    if (!toast?.anchor || !toastRef.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToastPosition(null);
      return;
    }
    const width = toastRef.current.offsetWidth;
    const padding = 12;
    const isRight = toast.placement === "right";
    const minLeft = isRight ? padding : padding + width / 2;
    const maxLeft = isRight
      ? window.innerWidth - padding - width
      : window.innerWidth - padding - width / 2;
    const clampedLeft = Math.min(Math.max(toast.anchor.left, minLeft), maxLeft);
    setToastPosition({ left: clampedLeft, top: toast.anchor.top });
  }, [toast?.anchor, toast?.message, toast?.placement]);

  const isValidUid = (value: string) => /^[0-9a-fA-F-]{36}$/.test(value.trim());

  const getToastAnchor = useCallback(
    (el?: HTMLElement | null, placement?: "above" | "right") => {
      const fallback =
        typeof document !== "undefined" && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const target = el ?? toastAnchorRef.current ?? fallback;
      if (!target) return null;
      const rect = target.getBoundingClientRect();
      if (placement === "right") {
        return {
          left: rect.right + 8,
          top: rect.top + rect.height / 2,
        };
      }
      return {
        left: rect.left + rect.width / 2,
        top: rect.top - 8,
      };
    },
    [],
  );

  const showToast = useCallback(
    (
      message: string,
      tone: "error" | "success" | "default",
      anchorEl?: HTMLElement | null,
      placement: "above" | "right" = "above",
    ) => {
      const anchor = getToastAnchor(anchorEl, placement);
      setToast({ message, tone, anchor, placement });
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => {
        setToast(null);
      }, 2200);
    },
    [getToastAnchor],
  );

  useEffect(() => {
    if (!notice) return;
    const anchor = sendButtonRef.current;
    if (anchor) {
      toastAnchorRef.current = anchor;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    showToast(notice, noticeTone, anchor, "above");
    setNotice("");
  }, [notice, noticeTone, showToast]);

  const handleCopyUid = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.user.id);
      showToast(
        "已複製 UID。",
        "success",
        copyButtonRef.current,
        "right",
      );
    } catch {
      showToast(
        "複製失敗，請稍後再試。",
        "error",
        copyButtonRef.current,
        "right",
      );
    }
  };

  const handleSendRequest = async () => {
    if (sessionLoading) return;
    if (!session) {
      setNotice("請先登入。");
      setNoticeTone("error");
      return;
    }
    if (sendLoading) return;

    setSendLoading(true);
    const uid = uidInput.trim();
    if (!uid) {
      setNotice("請輸入 UID。");
      setNoticeTone("error");
      setSendLoading(false);
      return;
    }
    if (!isValidUid(uid)) {
      setNotice("UID 格式不正確。");
      setNoticeTone("error");
      setSendLoading(false);
      return;
    }
    if (uid === session.user.id) {
      setNotice("不能新增自己為好友。");
      setNoticeTone("error");
      setSendLoading(false);
      return;
    }

    if (friends.some((friend) => friend.friend_id === uid)) {
      setNotice("此 UID 已在好友清單中。");
      setNoticeTone("error");
      setSendLoading(false);
      return;
    }

    const sendResponse = await fetch("/api/friends/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: uid }),
    });

    if (!sendResponse.ok) {
      setNotice("好友邀請送出失敗，請稍後再試。");
      setNoticeTone("error");
      setSendLoading(false);
      return;
    }

    setUidInput("");
    await loadRequestsAndFriends(session, true);
    setNotice("好友邀請已送出。");
    setNoticeTone("success");
    setSendLoading(false);
  };

  const handleAccept = async (
    requestId: string,
    anchorEl?: HTMLButtonElement | null,
  ) => {
    const response = await fetch("/api/friends/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId }),
    });

    if (!response.ok) {
      showToast("操作失敗，請稍後再試。", "error", anchorEl, "above");
      return;
    }

    if (session) {
      await loadRequestsAndFriends(session, true);
    }
    dispatchFriendNoticeRefresh();
    showToast("已同意好友邀請。", "success", anchorEl, "above");
  };

  const handleReject = async (
    requestId: string,
    anchorEl?: HTMLButtonElement | null,
  ) => {
    const response = await fetch("/api/friends/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId }),
    });

    if (!response.ok) {
      showToast("操作失敗，請稍後再試。", "error", anchorEl, "above");
      return;
    }

    if (session) {
      await loadRequestsAndFriends(session, true);
    }
    dispatchFriendNoticeRefresh();
    showToast("已拒絕好友邀請。", "success", anchorEl, "above");
  };
  const handleRevoke = async (
    requestId: string,
    anchorEl?: HTMLButtonElement | null,
  ) => {
    const response = await fetch("/api/friends/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId }),
    });

    if (!response.ok) {
      showToast("撤回邀請失敗，請稍後再試。", "error", anchorEl, "above");
      return;
    }

    if (session) {
      await loadRequestsAndFriends(session, true);
    }
    showToast("已撤回邀請。", "success", anchorEl, "above");
  };

  const handleRemoveFriend = async (anchorEl?: HTMLButtonElement | null) => {
    if (!deleteTarget) return;
    if (deleteLoading) return;
    if (deleteConfirmText.trim() !== "刪除好友") {
      setDeleteNotice("請輸入「刪除好友」以確認。");
      return;
    }

    setDeleteLoading(true);
    const response = await fetch("/api/friends/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: deleteTarget.friend_id }),
    });

    if (!response.ok) {
      showToast("刪除好友失敗，請稍後再試。", "error", anchorEl ?? deleteAnchorRef.current, "above");
      setDeleteLoading(false);
      return;
    }




    setDeleteTarget(null);
    if (session) {
      await loadRequestsAndFriends(session, true);
    }
    showToast("已刪除好友。", "success", anchorEl ?? deleteAnchorRef.current, "above");
    setDeleteLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <SiteHeader />
      <main className="min-h-screen px-8 pb-16 pt-24">
        <div className="mx-auto w-full page-shell">
          {toast && (
            <div
              ref={toastRef}
              className={`fixed z-50 whitespace-nowrap rounded-full border border-white/15 bg-black/80 px-3 py-1.5 text-xs ${
                toast.anchor
                  ? toast.placement === "right"
                    ? "-translate-y-1/2"
                    : "-translate-x-1/2 -translate-y-full"
                  : "right-6 top-24"
              }`}
              style={
                toast.anchor
                  ? {
                      left: toastPosition?.left ?? toast.anchor.left,
                      top: toastPosition?.top ?? toast.anchor.top,
                    }
                  : undefined
              }
            >
              <span
                className={
                  toast.tone === "error"
                    ? "text-red-300"
                    : toast.tone === "success"
                      ? "text-emerald-300"
                      : "text-white/70"
                }
              >
                {toast.message}
              </span>
            </div>
          )}
          <div id="search-results-slot" className="mb-6" />
          <RequireAuthGate>
            <div className="page-content">
              <h1 className="text-2xl font-semibold">好友</h1>
              <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="flex flex-col gap-6">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                    <p className="text-sm text-white/60">我的 UID</p>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        className="rounded-full border border-white/15 px-5 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={handleCopyUid}
                        disabled={!session}
                        ref={copyButtonRef}
                      >
                        複製我的 UID
                      </button>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                    <p className="text-sm text-white/60">輸入好友 UID</p>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <input
                        type="text"
                        name="friend-uid"
                        className="w-full max-w-xs rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm text-white/80 outline-none focus:border-white/40"
                        placeholder="貼上或輸入 UID"
                        value={uidInput}
                        onChange={(event) => setUidInput(event.target.value)}
                      />
                      <button
                        type="button"
                        className="rounded-full border border-white/15 px-5 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={handleSendRequest}
                        disabled={sendLoading}
                        ref={sendButtonRef}
                      >
                        {sendLoading ? "送出中..." : "新增好友"}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                    <h2 className="text-base font-semibold">好友邀請</h2>
                    {requests.length === 0 ? (
                      <p className="mt-2 text-sm text-white/60">
                        目前沒有邀請。
                      </p>
                    ) : (
                      <div className="mt-4 grid gap-3">
                        {requests.map((request) => (
                          <div
                            key={request.id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3"
                          >
                            <div className="flex items-center gap-3">
                              {(() => {
                                const requesterName = resolveName(
                                  request.from_user_id,
                                  request.from_nickname,
                                );
                                const requesterAvatar = resolveAvatarUrl(
                                  request.from_user_id,
                                );
                                return (
                                  <>
                                    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-white/5 text-xs font-semibold text-white/80">
                                      {requesterAvatar ? (
                                        <Image
                                          src={requesterAvatar}
                                          alt=""
                                          fill
                                          sizes="40px"
                                          className="object-cover"
                                        />
                                      ) : (
                                        requesterName
                                          .trim()
                                          .slice(0, 1)
                                          .toUpperCase()
                                      )}
                                    </div>
                                    <div>
                                      <p className="text-sm text-white/80">
                                        {requesterName}
                                      </p>
                                      <p className="text-xs text-white/40">
                                        UID: {request.from_user_id}
                                      </p>
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40"
                                onClick={(event) =>
                                  handleAccept(request.id, event.currentTarget)
                                }
                              >
                                同意
                              </button>
                              <button
                                type="button"
                                className="rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40"
                                onClick={(event) =>
                                  handleReject(request.id, event.currentTarget)
                                }
                              >
                                拒絕
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                    <h2 className="text-base font-semibold">已送出邀請</h2>
                    {outgoingRequests.length === 0 ? (
                      <p className="mt-2 text-sm text-white/60">
                        目前沒有送出邀請。
                      </p>
                    ) : (
                      <div className="mt-4 grid gap-3">
                        {outgoingRequests.map((request) => (
                          <div
                            key={request.id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3"
                          >
                            <div>
                              <p className="text-sm text-white/80">等待回應</p>
                              <p className="text-xs text-white/40">
                                UID: {request.to_user_id}
                              </p>
                            </div>
                            <button
                              type="button"
                              className="rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40"
                              onClick={(event) =>
                                handleRevoke(request.id, event.currentTarget)
                              }
                            >
                              撤回邀請
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                  <h2 className="text-base font-semibold">好友清單</h2>
                  {friends.length === 0 ? (
                    <p className="mt-2 text-sm text-white/60">
                      尚未有好友資料。
                    </p>
                  ) : (
                    <div className="mt-4 grid gap-3">
                      {friends.map((friend) => (
                        <div
                          key={friend.friend_id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3"
                        >
                          <div className="flex items-center gap-3">
                            {(() => {
                              const friendName = resolveName(
                                friend.friend_id,
                                friend.friend_nickname,
                              );
                              const avatarUrl = resolveAvatarUrl(
                                friend.friend_id,
                              );
                              return (
                                <>
                                  <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-white/5 text-xs font-semibold text-white/80">
                                    {avatarUrl ? (
                                      <Image
                                        src={avatarUrl}
                                        alt=""
                                        fill
                                        sizes="40px"
                                        className="object-cover"
                                      />
                                    ) : (
                                      friendName
                                        .trim()
                                        .slice(0, 1)
                                        .toUpperCase()
                                    )}
                                  </div>
                                  <div>
                                    <p className="text-sm text-white/80">
                                      {friendName}
                                    </p>
                                    <p className="text-xs text-white/40">
                                      UID: {friend.friend_id}
                                    </p>
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                          <button
                            type="button"
                            className="rounded-full border border-red-500/40 px-4 py-2 text-xs uppercase tracking-[0.2em] text-red-300 transition hover:border-red-400"
                            onClick={(event) => {
                              deleteAnchorRef.current = event.currentTarget;
                              setDeleteTarget(friend);
                            }}
                          >
                            刪除
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </RequireAuthGate>
        </div>
      </main>
      <SiteFooter />
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b0b0c] p-6 text-left"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white">確認刪除好友</h3>
            <p className="mt-2 text-sm text-white/60">
              刪除好友不會刪除紀錄本體；若你是建立者，對方會從你建立的同步紀錄中移除；
              若對方是建立者，你也會從該同步紀錄中移除；若雙方都不是建立者，紀錄不變，只是不再顯示彼此。
            </p>
            <p className="mt-3 text-sm text-white/60">
              若要刪除好友，請輸入「刪除好友」。
            </p>
            <div className="mt-4 grid gap-3">
              <input
                type="text"
                name="delete-friend-confirm"
                placeholder="刪除好友"
                className="w-full rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm text-white/80 outline-none focus:border-white/40"
                value={deleteConfirmText}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
              />
            </div>
            {deleteNotice && (
              <p className="mt-3 text-xs text-red-300">{deleteNotice}</p>
            )}
            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                className="rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteLoading}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-full border border-red-500/50 px-4 py-2 text-xs uppercase tracking-[0.2em] text-red-300 transition hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => handleRemoveFriend()}
                disabled={deleteLoading}
              >
                {deleteLoading ? "刪除中..." : "確認刪除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
