"use client";

import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { supabase } from "@/lib/supabaseClient";

export default function AccountPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [nickname, setNickname] = useState("");
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<"default" | "error" | "success">(
    "default"
  );
  const [copyMessage, setCopyMessage] = useState("");
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data.session ?? null);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
      }
    );

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(
    () => () => {
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!session) {
      queueMicrotask(() => {
        setNickname("");
        setProfileLoaded(false);
      });
      return;
    }

    let isMounted = true;
    queueMicrotask(() => {
      setProfileLoaded(false);
    });

    supabase
      .from("profiles")
      .select("nickname")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!isMounted) return;
        setNickname(data?.nickname ?? "");
        setProfileLoaded(true);
      });

    return () => {
      isMounted = false;
    };
  }, [session]);

  const handleSaveNickname = async () => {
    if (!session) {
      setStatusMessage("請先登入以設定暱稱。");
      setStatusTone("error");
      return;
    }

    const trimmed = nickname.trim();
    if (!trimmed) {
      setStatusMessage("請輸入暱稱。");
      setStatusTone("error");
      return;
    }

    setSaving(true);
    setStatusMessage("");
    setStatusTone("default");

    const { error } = await supabase.from("profiles").upsert({
      id: session.user.id,
      nickname: trimmed,
    });

    if (error) {
      setStatusMessage("暱稱更新失敗，請稍後再試。");
      setStatusTone("error");
    } else {
      setStatusMessage("暱稱已更新。");
      setStatusTone("success");
      setNickname(trimmed);
    }

    setSaving(false);
  };

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

  const nicknameReady = profileLoaded && nickname.trim().length > 0;

  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <SiteHeader />
      <main className="min-h-screen px-8 pb-16 pt-24">
        <div className="mx-auto w-full page-shell">
          <div id="search-results-slot" className="mb-6" />
          <div className="page-content">
            <h1 className="text-2xl font-semibold">帳戶</h1>
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6">
              <p className="text-sm text-white/60">電子郵件</p>
              <p className="mt-2 text-base text-white/90">
                {session?.user?.email ?? "尚未登入"}
              </p>
            </div>
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-6">
              <p className="text-sm text-white/60">暱稱</p>
              <p className="mt-2 text-xs text-white/50">顯示給好友的名稱</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  name="nickname"
                  className="w-full max-w-xs rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm text-white/80 outline-none focus:border-white/40"
                  placeholder={profileLoaded ? "請輸入暱稱" : "載入中..."}
                  value={profileLoaded ? nickname : ""}
                  onChange={(event) => setNickname(event.target.value)}
                  disabled={!profileLoaded}
                />
                <button
                  type="button"
                  className="rounded-full border border-white/15 px-5 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleSaveNickname}
                  disabled={saving || !profileLoaded}
                >
                  {saving ? "儲存中..." : "儲存"}
                </button>
              </div>
              {statusMessage && (
                <p
                  className={`mt-2 text-xs ${
                    statusTone === "error"
                      ? "text-red-300"
                      : statusTone === "success"
                      ? "text-emerald-300"
                      : "text-white/60"
                  }`}
                >
                  {statusMessage}
                </p>
              )}
              {profileLoaded && !nicknameReady && (
                <p className="mt-2 text-xs text-white/50">
                  需設定暱稱後才能分享 UID。
                </p>
              )}
            </div>
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-6">
              <p className="text-sm text-white/60">我的 UID</p>
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  className="rounded-full border border-white/15 px-5 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleCopyUid}
                  disabled={!profileLoaded || !nicknameReady || !session}
                >
                  複製 UID
                </button>
                {copyMessage && (
                  <span className="text-xs text-white/60">{copyMessage}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
