"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import RequireAuthGate from "@/components/RequireAuthGate";
import { supabase } from "@/lib/supabaseClient";

const PROJECT_ID = "watch";

type FriendRequest = {
  id: string;
  from_user_id: string;
  from_nickname: string | null;
  created_at: string;
};

type FriendEntry = {
  friend_id: string;
  friend_nickname: string | null;
  created_at: string;
};

export default function FriendsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [nickname, setNickname] = useState("");
  const [nicknameLoaded, setNicknameLoaded] = useState(false);
  const [uidInput, setUidInput] = useState("");
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"default" | "error" | "success">(
    "default"
  );
  const [copyMessage, setCopyMessage] = useState("");
  const copyTimerRef = useRef<number | null>(null);

  const nicknameReady = useMemo(
    () => nicknameLoaded && nickname.trim().length > 0,
    [nicknameLoaded, nickname]
  );

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data.session ?? null);
      setSessionLoading(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        setSessionLoading(false);
      }
    );

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      queueMicrotask(() => {
        setNickname("");
        setNicknameLoaded(false);
      });
      return;
    }

    let isMounted = true;
    queueMicrotask(() => {
      setNicknameLoaded(false);
    });

    supabase
      .from("profiles")
      .select("nickname")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!isMounted) return;
        setNickname(data?.nickname ?? "");
        setNicknameLoaded(true);
      });

    return () => {
      isMounted = false;
    };
  }, [session]);

  const loadRequestsAndFriends = async (
    currentSession: Session,
    preserveNotice = false
  ) => {
    setListLoading(true);
    if (!preserveNotice) {
      setNotice("");
      setNoticeTone("default");
    }

    const [requestRes, friendsRes] = await Promise.all([
      supabase
        .from("friend_requests")
        .select("id, from_user_id, from_nickname, created_at")
        .eq("to_user_id", currentSession.user.id)
        .eq("project_id", PROJECT_ID)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("friends")
        .select("friend_id, friend_nickname, created_at")
        .eq("user_id", currentSession.user.id)
        .eq("project_id", PROJECT_ID)
        .order("created_at", { ascending: false }),
    ]);

    if (requestRes.error || friendsRes.error) {
      setNotice("載入好友資料失敗，請稍後再試。");
      setNoticeTone("error");
    }

    setRequests((requestRes.data as FriendRequest[]) ?? []);
    setFriends((friendsRes.data as FriendEntry[]) ?? []);
    setListLoading(false);
  };

  useEffect(() => {
    if (!session || sessionLoading) return;
    queueMicrotask(() => {
      loadRequestsAndFriends(session);
    });
  }, [session, sessionLoading]);

  useEffect(
    () => () => {
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!session || sessionLoading) return;

    const requestsChannel = supabase
      .channel("friend-requests-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friend_requests",
          filter: `to_user_id=eq.${session.user.id}`,
        },
        () => {
          loadRequestsAndFriends(session);
        }
      )
      .subscribe();

    const friendsChannel = supabase
      .channel("friends-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friends",
          filter: `user_id=eq.${session.user.id}`,
        },
        () => {
          loadRequestsAndFriends(session);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(requestsChannel);
      supabase.removeChannel(friendsChannel);
    };
  }, [session, sessionLoading]);

  const isValidUid = (value: string) =>
    /^[0-9a-fA-F-]{36}$/.test(value.trim());

  const handleCopyUid = async () => {
    if (!session) return;
    if (copyTimerRef.current) {
      window.clearTimeout(copyTimerRef.current);
    }
    try {
      await navigator.clipboard.writeText(session.user.id);
      setCopyMessage("已複製 UID。");
    } catch {
      setCopyMessage("複製失敗，請稍後再試。");
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopyMessage("");
    }, 2000);
  };

  const handleSendRequest = async () => {
    if (sessionLoading) return;
    if (!session) {
      setNotice("請先登入以新增好友。");
      setNoticeTone("error");
      return;
    }
    if (sendLoading) return;
    if (!nicknameReady) {
      setNotice("請先到帳戶頁設定暱稱後再新增好友。");
      setNoticeTone("error");
      return;
    }

    setSendLoading(true);
    const uid = uidInput.trim();
    if (!uid) {
      setNotice("請輸入好友 UID。");
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
      setNotice("你們已經是好友了。");
      setNoticeTone("error");
      setSendLoading(false);
      return;
    }

    const pendingOutgoing = await supabase
      .from("friend_requests")
      .select("id")
      .eq("from_user_id", session.user.id)
      .eq("to_user_id", uid)
      .eq("project_id", PROJECT_ID)
      .eq("status", "pending")
      .maybeSingle();

    if (pendingOutgoing.data) {
      setNotice("你已經送出好友邀請。請等待對方回應。");
      setNoticeTone("error");
      setSendLoading(false);
      return;
    }

    const existingRequest = await supabase
      .from("friend_requests")
      .select("status")
      .eq("from_user_id", session.user.id)
      .eq("to_user_id", uid)
      .eq("project_id", PROJECT_ID)
      .maybeSingle();

    if (existingRequest.data?.status) {
      if (existingRequest.data.status === "accepted") {
        setNotice("你們已經是好友了。");
      } else {
        setNotice("你已經送出好友邀請。請等待對方回應。");
      }
      setNoticeTone("error");
      setSendLoading(false);
      return;
    }

    const pendingIncoming = await supabase
      .from("friend_requests")
      .select("id")
      .eq("from_user_id", uid)
      .eq("to_user_id", session.user.id)
      .eq("project_id", PROJECT_ID)
      .eq("status", "pending")
      .maybeSingle();

    if (pendingIncoming.data) {
      setNotice("對方已送出邀請，請在下方回應。");
      setNoticeTone("error");
      setSendLoading(false);
      return;
    }

    const { data: userExists, error: userExistsError } =
      await supabase.rpc("check_user_exists", { target_id: uid });

    if (userExistsError) {
      setNotice("查詢 UID 失敗，請稍後再試。");
      setNoticeTone("error");
      setSendLoading(false);
      return;
    }

    if (!userExists) {
      setNotice("找不到此 UID，請確認輸入是否正確。");
      setNoticeTone("error");
      setSendLoading(false);
      return;
    }

    const { error } = await supabase.from("friend_requests").insert({
      from_user_id: session.user.id,
      to_user_id: uid,
      from_nickname: nickname.trim(),
      status: "pending",
      project_id: PROJECT_ID,
    });

    if (error) {
      if (error.code === "23505" || error.status === 409) {
        setNotice("你已經送出好友邀請。請等待對方回應。");
      } else if (error.code === "23503") {
        setNotice("找不到此 UID，請確認輸入是否正確。");
      } else {
        setNotice("送出邀請失敗，請稍後再試。");
      }
      setNoticeTone("error");
      setSendLoading(false);
      return;
    }

    setUidInput("");
    await loadRequestsAndFriends(session, true);
    setNotice("已發出好友邀請。");
    setNoticeTone("success");
    setSendLoading(false);
  };

  const handleAccept = async (requestId: string) => {
    const { error } = await supabase.rpc("accept_friend_request", {
      request_id: requestId,
    });

    if (error) {
      setNotice("同意失敗，請稍後再試。");
      setNoticeTone("error");
      return;
    }

    if (session) {
      await loadRequestsAndFriends(session, true);
    }
    setNotice("已成為好友。");
    setNoticeTone("success");
  };

  const handleReject = async (requestId: string) => {
    const { error } = await supabase.rpc("reject_friend_request", {
      request_id: requestId,
    });

    if (error) {
      setNotice("拒絕失敗，請稍後再試。");
      setNoticeTone("error");
      return;
    }

    if (session) {
      await loadRequestsAndFriends(session, true);
    }
    setNotice("已拒絕好友邀請。");
    setNoticeTone("success");
  };

  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <SiteHeader />
      <main className="min-h-screen px-8 pb-16 pt-24">
        <div className="mx-auto w-full page-shell">
          <div id="search-results-slot" className="mb-6" />
          <RequireAuthGate>
            <div className="page-content">
              <h1 className="text-2xl font-semibold">好友</h1>
              <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="flex flex-col gap-6">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                    <p className="text-sm text-white/60">我的 UID</p>
                    {!nicknameReady && (
                      <p className="mt-2 text-xs text-white/50">
                        需先到帳戶頁設定暱稱後才能分享。
                      </p>
                    )}
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      {nicknameReady ? (
                        <button
                          type="button"
                          className="rounded-full border border-white/15 px-5 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={handleCopyUid}
                          disabled={!session}
                        >
                          複製我的 UID
                        </button>
                      ) : (
                        <Link
                          href="/account"
                          className="inline-flex w-fit rounded-full border border-white/15 px-5 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40"
                        >
                          前往設定暱稱
                        </Link>
                      )}
                      {copyMessage && (
                        <span className="text-xs text-white/60">
                          {copyMessage}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                    <p className="text-sm text-white/60">輸入好友 UID</p>
                    {!nicknameReady && (
                      <p className="mt-2 text-xs text-white/50">
                        需先到帳戶頁設定暱稱後才能送出邀請。
                      </p>
                    )}
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
                      >
                        {sendLoading ? "送出中..." : "新增好友"}
                      </button>
                    </div>
                  </div>

                  {notice && (
                    <p
                      className={`text-xs ${
                        noticeTone === "error"
                          ? "text-red-300"
                          : noticeTone === "success"
                          ? "text-emerald-300"
                          : "text-white/60"
                      }`}
                    >
                      {notice}
                    </p>
                  )}

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
                              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/5 text-xs font-semibold text-white/80">
                                {(request.from_nickname ?? "?")
                                  .trim()
                                  .slice(0, 1)
                                  .toUpperCase()}
                              </div>
                              <div>
                                <p className="text-sm text-white/80">
                                  {request.from_nickname || "未設定暱稱"}
                                </p>
                                <p className="text-xs text-white/40">
                                  UID: {request.from_user_id}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40"
                                onClick={() => handleAccept(request.id)}
                              >
                                同意
                              </button>
                              <button
                                type="button"
                                className="rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40"
                                onClick={() => handleReject(request.id)}
                              >
                                拒絕
                              </button>
                            </div>
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
                            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/5 text-xs font-semibold text-white/80">
                              {(friend.friend_nickname ?? "?")
                                .trim()
                                .slice(0, 1)
                                .toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm text-white/80">
                                {friend.friend_nickname || "未設定暱稱"}
                              </p>
                              <p className="text-xs text-white/40">
                                UID: {friend.friend_id}
                              </p>
                            </div>
                          </div>
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
    </div>
  );
}
