"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState("");
  const router = useRouter();

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

  useEffect(() => {
    if (!deleteOpen) {
      queueMicrotask(() => {
        setDeleteEmail("");
        setDeletePassword("");
        setDeleteNotice("");
      });
    }
  }, [deleteOpen]);

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

  const handleDeleteAccount = async () => {
    if (!session) {
      setDeleteNotice("請先登入以刪除帳戶。");
      return;
    }
    if (deleteLoading) return;

    const emailInput = deleteEmail.trim();
    if (!emailInput || !deletePassword) {
      setDeleteNotice("請輸入電子郵件與密碼。");
      return;
    }
    if (emailInput !== session.user.email) {
      setDeleteNotice("電子郵件不符，請確認後再試。");
      return;
    }

    setDeleteLoading(true);
    setDeleteNotice("");

    const { data: reauthData, error: reauthError } =
      await supabase.auth.signInWithPassword({
        email: emailInput,
        password: deletePassword,
      });

    if (reauthError || !reauthData.session) {
      setDeleteNotice("驗證失敗，請確認帳號密碼。");
      setDeleteLoading(false);
      return;
    }

    const response = await fetch("/api/account/delete", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${reauthData.session.access_token}`,
      },
    });

    if (!response.ok) {
      setDeleteNotice("刪除失敗，請稍後再試。");
      setDeleteLoading(false);
      return;
    }

    await supabase.auth.signOut();
    router.push("/");
  };

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
            </div>
            <div className="mt-6 rounded-2xl border border-red-500/40 bg-white/5 p-6">
              <h2 className="text-base font-semibold text-red-300">
                刪除帳戶
              </h2>
              <p className="mt-2 text-xs text-white/60">
                刪除後將無法復原，包含清單與觀看紀錄。
              </p>
              <button
                type="button"
                className="mt-4 rounded-full border border-red-500/40 px-5 py-2 text-xs uppercase tracking-[0.2em] text-red-300 transition hover:border-red-400"
                onClick={() => setDeleteOpen(true)}
                disabled={!session}
              >
                刪除帳戶
              </button>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
      {deleteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6"
          onClick={() => setDeleteOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b0b0c] p-6 text-left"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white">
              確認刪除帳戶
            </h3>
            <p className="mt-2 text-sm text-white/60">
              請再次輸入帳號密碼以確認刪除。
            </p>
            <div className="mt-4 grid gap-3">
              <input
                type="email"
                name="delete-email"
                placeholder="電子郵件"
                className="w-full rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm text-white/80 outline-none focus:border-white/40"
                value={deleteEmail}
                onChange={(event) => setDeleteEmail(event.target.value)}
              />
              <input
                type="password"
                name="delete-password"
                placeholder="密碼"
                className="w-full rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm text-white/80 outline-none focus:border-white/40"
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
              />
            </div>
            {deleteNotice && (
              <p className="mt-3 text-xs text-red-300">{deleteNotice}</p>
            )}
            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                className="rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40"
                onClick={() => setDeleteOpen(false)}
                disabled={deleteLoading}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-full border border-red-500/50 px-4 py-2 text-xs uppercase tracking-[0.2em] text-red-300 transition hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleDeleteAccount}
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
