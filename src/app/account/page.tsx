"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import useAuth from "@/hooks/useAuth";

type ProfileMeResponse = {
  id: string;
  email: string | null;
  nickname: string | null;
  avatarUrl: string | null;
};

export default function AccountPage() {
  const { session, loading } = useAuth();
  const [nickname, setNickname] = useState("");
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [nicknameEditing, setNicknameEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<"default" | "error" | "success">(
    "default"
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteMode, setDeleteMode] = useState<"site" | "account">("site");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState("");
  const [deleteNoticeTone, setDeleteNoticeTone] = useState<
    "default" | "error" | "success"
  >("default");
  const router = useRouter();

  useEffect(() => {
    if (loading || session) {
      return;
    }
    router.replace("/login?callbackUrl=%2Faccount");
  }, [loading, router, session]);

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
      const response = await fetch("/api/profile/me", { cache: "no-store" });

      if (!isMounted) return;

      const fallbackNickname =
        session.user.user_metadata?.full_name ||
        session.user.user_metadata?.name ||
        session.user.user_metadata?.preferred_username ||
        "";

      if (!response.ok) {
        setNickname(fallbackNickname);
        setProfileLoaded(true);
        return;
      }

      const data = (await response.json()) as ProfileMeResponse;
      setNickname(data.nickname ?? fallbackNickname);
      setProfileLoaded(true);
    };

    loadProfile().catch(() => {
      if (!isMounted) return;
      const fallbackNickname =
        session.user.user_metadata?.full_name ||
        session.user.user_metadata?.name ||
        session.user.user_metadata?.preferred_username ||
        "";
      setNickname(fallbackNickname);
      setProfileLoaded(true);
    });

    return () => {
      isMounted = false;
    };
  }, [session]);

  useEffect(() => {
    if (!deleteOpen) {
      queueMicrotask(() => {
        setDeleteConfirmText("");
        setDeleteNotice("");
        setDeleteNoticeTone("default");
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

    const response = await fetch("/api/profile/me", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nickname: trimmed,
      }),
    });

    if (!response.ok) {
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
      setDeleteNoticeTone("error");
      return;
    }
    if (deleteLoading) return;

    const confirmPhrase = deleteMode === "account" ? "刪除帳戶" : "刪除本網站";
    if (deleteConfirmText.trim() !== confirmPhrase) {
      setDeleteNotice(`請輸入「${confirmPhrase}」以確認。`);
      setDeleteNoticeTone("error");
      return;
    }

    setDeleteLoading(true);
    setDeleteNotice("");
    setDeleteNoticeTone("default");

    const endpoint =
      deleteMode === "account" ? "/api/account/delete" : "/api/account/delete-site";
    const response = await fetch(endpoint, {
      method: "POST",
    });

    if (!response.ok) {
      setDeleteNotice("刪除失敗，請稍後再試。");
      setDeleteNoticeTone("error");
      setDeleteLoading(false);
      return;
    }

    if (deleteMode === "account") {
      await signOut({ callbackUrl: "/" });
      return;
    }

    setDeleteNotice("已刪除本網站資料。");
    setDeleteNoticeTone("success");
    setDeleteLoading(false);
    setDeleteConfirmText("");
    router.refresh();
  };

  if (loading || !session) {
    return null;
  }

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
              <h2 className="text-base font-semibold text-red-300">刪除資料或帳戶</h2>
              <p className="mt-2 text-xs text-white/60">
                你可以選擇只刪除 watch 站內資料，或刪除整個帳號。刪除後都無法復原；你建立的同步紀錄會一併移除，他人建立的紀錄會保留但不再顯示你。
              </p>
              <button
                type="button"
                className="mt-4 rounded-full border border-red-500/40 px-5 py-2 text-xs uppercase tracking-[0.2em] text-red-300 transition hover:border-red-400"
                onClick={() => {
                  setDeleteMode("site");
                  setDeleteOpen(true);
                }}
                disabled={!session}
              >
                選擇刪除方式
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
            <h3 className="text-lg font-semibold text-white">確認刪除資料或帳戶</h3>
            <div className="mt-3 grid gap-3 text-sm text-white/70">
              <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                <input
                  type="radio"
                  name="delete-mode"
                  className="mt-1 h-4 w-4"
                  checked={deleteMode === "site"}
                  onChange={() => setDeleteMode("site")}
                />
                <div>
                  <p className="text-sm text-white/90">只刪除本網站資料</p>
                  <p className="mt-1 text-xs text-white/60">
                    只會移除 watch 的清單、觀看紀錄與好友資料。
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                <input
                  type="radio"
                  name="delete-mode"
                  className="mt-1 h-4 w-4"
                  checked={deleteMode === "account"}
                  onChange={() => setDeleteMode("account")}
                />
                <div>
                  <p className="text-sm text-white/90">刪除整個帳號</p>
                  <p className="mt-1 text-xs text-white/60">
                    會刪除你在 watch 這個網站上的帳號資料，並使目前登入失效。
                  </p>
                </div>
              </label>
            </div>
            <p className="mt-3 text-sm text-white/60">
              請輸入「{deleteMode === "account" ? "刪除帳戶" : "刪除本網站"}」以確認。
            </p>
            <div className="mt-4 grid gap-3">
              <input
                type="text"
                name="delete-account-confirm"
                placeholder={deleteMode === "account" ? "刪除帳戶" : "刪除本網站"}
                className="w-full rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm text-white/80 outline-none focus:border-white/40"
                value={deleteConfirmText}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
              />
            </div>
            {deleteNotice && (
              <p
                className={`mt-3 text-xs ${
                  deleteNoticeTone === "success" ? "text-emerald-300" : "text-red-300"
                }`}
              >
                {deleteNotice}
              </p>
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

