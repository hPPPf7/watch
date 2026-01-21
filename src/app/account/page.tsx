"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { supabase } from "@/lib/supabaseClient";
import { syncProfileFromUser } from "@/lib/profileSync";
import useAuth from "@/hooks/useAuth";

export default function AccountPage() {
  const { session } = useAuth();
  const [nickname, setNickname] = useState("");
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [nicknameEditing, setNicknameEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<"default" | "error" | "success">(
    "default"
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState("");
  const router = useRouter();

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

    const loadProfile = async () => {
      await syncProfileFromUser(session.user);
      const { data } = await supabase
        .from("profiles")
        .select("nickname")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!isMounted) return;
      const fallbackNickname =
        session.user.user_metadata?.full_name ||
        session.user.user_metadata?.name ||
        session.user.user_metadata?.preferred_username ||
        "";
      setNickname(data?.nickname ?? fallbackNickname);
      setProfileLoaded(true);
    };

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, [session]);

  useEffect(() => {
    if (!deleteOpen) {
      queueMicrotask(() => {
        setDeleteConfirmText("");
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
      setNicknameEditing(false);
    }

    setSaving(false);
  };

  const handleDeleteAccount = async () => {
    if (!session) {
      setDeleteNotice("請先登入以刪除帳戶。");
      return;
    }
    if (deleteLoading) return;

    if (deleteConfirmText.trim() !== "刪除帳戶") {
      setDeleteNotice("請輸入「刪除帳戶」以確認。");
      return;
    }

    setDeleteLoading(true);
    setDeleteNotice("");

    const response = await fetch("/api/account/delete", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
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
              <p className="mt-2 text-xs text-white/50">
                顯示給好友的名稱，預設取自 Google 名稱。
              </p>
              {!nicknameEditing ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <p className="text-base text-white/90">
                    {profileLoaded ? nickname || "尚未設定" : "載入中..."}
                  </p>
                  <button
                    type="button"
                    className="rounded-full border border-white/15 px-5 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => {
                      if (!profileLoaded) return;
                      setNicknameEditing(true);
                    }}
                    disabled={!profileLoaded}
                  >
                    修改
                  </button>
                </div>
              ) : (
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
                  <button
                    type="button"
                    className="rounded-full border border-white/10 px-5 py-2 text-xs uppercase tracking-[0.2em] text-white/60 transition hover:border-white/30"
                    onClick={() => setNicknameEditing(false)}
                    disabled={saving}
                  >
                    取消
                  </button>
                </div>
              )}
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
              請輸入「刪除帳戶」以確認。
            </p>
            <div className="mt-4 grid gap-3">
              <input
                type="text"
                name="delete-account-confirm"
                placeholder="刪除帳戶"
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
