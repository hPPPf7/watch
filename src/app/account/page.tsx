"use client";

import useAccountFetch from "@/hooks/useAccountFetch";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { clearWatchUserCache } from "@/lib/clearWatchUserCache";
import useAuth from "@/hooks/useAuth";

type ProfileMeResponse = {
  id: string;
  email: string | null;
  nickname: string | null;
  avatarUrl: string | null;
};

export default function AccountPage() {
  const fetch = useAccountFetch();
  const { session, loading } = useAuth();
  const [nickname, setNickname] = useState("");
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [profileRetryToken, setProfileRetryToken] = useState(0);
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
        setProfileLoading(false);
        setProfileError("");
      });
      return;
    }

    let isMounted = true;
    queueMicrotask(() => {
      if (isMounted) setProfileLoading(true);
    });

    const loadProfile = async () => {
      try {
        const response = await fetch("/api/profile/me", { cache: "no-store" });
        if (!response.ok) throw new Error("Profile unavailable");
        const data = (await response.json()) as ProfileMeResponse;
        if (!isMounted) return;

        const fallbackNickname =
          session.user.user_metadata?.full_name ||
          session.user.user_metadata?.name ||
          session.user.user_metadata?.preferred_username ||
          "";
        setNickname(data.nickname ?? fallbackNickname);
        setProfileLoaded(true);
        setProfileError("");
      } catch {
        if (!isMounted) return;
        setProfileError("暱稱讀取失敗，請重試。");
      } finally {
        if (isMounted) setProfileLoading(false);
      }
    };

    void loadProfile();

    return () => {
      isMounted = false;
    };
  }, [fetch, profileRetryToken, session]);

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
    try {
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
    } catch {
      setStatusMessage("儲存失敗，請稍後再試。"); setStatusTone("error");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!session) {
      setDeleteNotice("請先登入以刪除帳戶。");
      setDeleteNoticeTone("error");
      return;
    }
    if (deleteLoading) return;

    const confirmPhrase = deleteMode === "account" ? "刪除共用帳號" : "刪除本網站";
    if (deleteConfirmText.trim() !== confirmPhrase) {
      setDeleteNotice(`請輸入「${confirmPhrase}」以確認。`);
      setDeleteNoticeTone("error");
      return;
    }

    setDeleteLoading(true);
    try {
    setDeleteNotice("");
    setDeleteNoticeTone("default");

    const endpoint =
      deleteMode === "account" ? "/api/account/delete" : "/api/account/delete-site";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "x-watch-account-id": session.user.id },
    });

    if (!response.ok) {
      setDeleteNotice("刪除失敗，請稍後再試。");
      setDeleteNoticeTone("error");
      setDeleteLoading(false);
      return;
    }

      clearWatchUserCache(session.user.id);
    if (deleteMode === "account") {
      await signOut({ callbackUrl: "/" });
      return;
    }

    setDeleteNotice("已刪除本網站資料。");
    setDeleteNoticeTone("success");
    setDeleteLoading(false);
    setDeleteConfirmText("");
      window.location.reload();
    } catch {
      setDeleteNotice("刪除失敗，請稍後再試。"); setDeleteNoticeTone("error");
    } finally {
      setDeleteLoading(false);
    }
  };

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-watch-bg text-watch-text" role="status">
        <p className="watch-loading text-sm">
          <span className="watch-spinner" aria-hidden="true" />
          {loading ? "確認登入狀態..." : "正在前往登入頁面..."}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-watch-bg text-watch-text">
      <SiteHeader />
      <main className="min-h-screen px-8 pb-16 pt-20">
        <div className="mx-auto w-full page-shell">
          <div id="search-results-slot" className="mb-6" />
          <div className="page-content">
            <h1 className="text-2xl font-semibold">帳戶</h1>
            <div className="mt-6 rounded-2xl border border-watch-border-subtle bg-watch-surface p-6">
              <p className="text-sm text-watch-text-secondary">電子郵件</p>
              <p className="mt-2 text-base text-watch-text">
                {session?.user?.email ?? "尚未登入"}
              </p>
            </div>
            <div className="mt-4 rounded-2xl border border-watch-border-subtle bg-watch-surface p-6">
              <div className="flex items-center gap-3">
                <p className="text-sm text-watch-text-secondary">暱稱</p>
                {profileLoading && (
                  <span className="watch-loading shrink-0 whitespace-nowrap text-xs" role="status">
                    <span className="watch-spinner" aria-hidden="true" />
                    載入中...
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-watch-text-muted">
                顯示給好友的名稱，預設取自 Google 名稱。
              </p>
              {!nicknameEditing ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <p className="text-base text-watch-text">
                    {profileLoaded
                      ? nickname || "尚未設定"
                      : profileError
                        ? session.user.user_metadata?.full_name ||
                          session.user.user_metadata?.name ||
                          session.user.user_metadata?.preferred_username ||
                          "無法讀取暱稱"
                        : null}
                  </p>
                  <button
                    type="button"
                    className="watch-button"
                    onClick={() => {
                      if (!profileLoaded || profileLoading) return;
                      setNicknameEditing(true);
                    }}
                    disabled={!profileLoaded || profileLoading}
                  >
                    修改
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <input
                    type="text"
                    name="nickname"
                    aria-label="暱稱"
                    className="w-full max-w-xs watch-input"
                    placeholder={profileLoaded ? "請輸入暱稱" : "載入中..."}
                    value={profileLoaded ? nickname : ""}
                    onChange={(event) => setNickname(event.target.value)}
                    disabled={!profileLoaded || profileLoading}
                  />
                  <button
                    type="button"
                    className="watch-button watch-button--primary min-w-24"
                    aria-busy={saving}
                    onClick={handleSaveNickname}
                    disabled={saving || !profileLoaded || profileLoading}
                  >
                    <span className="watch-spinner-slot" aria-hidden="true">{saving && <span className="watch-spinner" />}</span>
                    {saving ? "儲存中..." : "儲存"}
                  </button>
                  <button
                    type="button"
                    className="watch-button"
                    onClick={() => setNicknameEditing(false)}
                    disabled={saving}
                  >
                    取消
                  </button>
                </div>
              )}
              {profileError && (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-watch-error" role="alert">
                  <span>{profileError}</span>
                  <button
                    type="button"
                    className="watch-button watch-button--small"
                    disabled={profileLoading || saving}
                    onClick={() => setProfileRetryToken((value) => value + 1)}
                  >
                    <span className="watch-spinner-slot" aria-hidden="true">{profileLoading && <span className="watch-spinner" />}</span>
                    重試
                  </button>
                </div>
              )}
              {statusMessage && (
                <p
                  className={`mt-2 text-xs ${
                    statusTone === "error"
                      ? "text-watch-error"
                      : statusTone === "success"
                        ? "text-watch-complete"
                        : "text-watch-text-secondary"
                  }`}
                >
                  {statusMessage}
                </p>
              )}
            </div>
            <div className="mt-6 rounded-2xl border border-watch-error/40 bg-watch-surface p-6">
              <h2 className="text-base font-semibold text-watch-error">刪除資料或帳號</h2>
              <p className="mt-2 text-xs text-watch-text-secondary">
                你可以選擇只刪除 Watch 站內資料，或刪除共用帳號。刪除後都無法復原；你建立的同步紀錄會一併移除，他人建立的紀錄會保留但不再顯示你。
              </p>
              <button
                type="button"
                className="mt-4 watch-button watch-button--danger"
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
            className="w-full max-w-md rounded-2xl border border-watch-border-subtle bg-watch-popover p-6 text-left"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-watch-text">確認刪除資料或帳號</h3>
            <div className="mt-3 grid gap-3 text-sm text-watch-text-secondary">
              <label className="flex items-start gap-3 rounded-xl border border-watch-border-subtle bg-watch-surface p-3">
                <input
                  type="radio"
                  name="delete-mode"
                  className="mt-1 h-4 w-4 accent-watch-progress"
                  checked={deleteMode === "site"}
                  onChange={() => setDeleteMode("site")}
                />
                <div>
                  <p className="text-sm text-watch-text">只刪除本網站資料</p>
                  <p className="mt-1 text-xs text-watch-text-secondary">
                    只會移除 Watch 的清單、觀看紀錄與好友資料；保留共用帳號與登入資格。
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-watch-border-subtle bg-watch-surface p-3">
                <input
                  type="radio"
                  name="delete-mode"
                  className="mt-1 h-4 w-4 accent-watch-progress"
                  checked={deleteMode === "account"}
                  onChange={() => setDeleteMode("account")}
                />
                <div>
                  <p className="text-sm text-watch-text">刪除共用帳號</p>
                  <p className="mt-1 text-xs text-watch-text-secondary">
                    會刪除 Watch 的資料及共用登入帳號、個人資料，並使此帳號的登入失效。其他網站的業務資料不會由此操作一併清除。
                  </p>
                </div>
              </label>
            </div>
            <p className="mt-3 text-sm text-watch-text-secondary">
              請輸入「{deleteMode === "account" ? "刪除共用帳號" : "刪除本網站"}」以確認。
            </p>
            <div className="mt-4 grid gap-3">
              <input
                type="text"
                name="delete-account-confirm"
                aria-label="刪除確認文字"
                placeholder={deleteMode === "account" ? "刪除共用帳號" : "刪除本網站"}
                className="w-full watch-input"
                value={deleteConfirmText}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
              />
            </div>
            {deleteNotice && (
              <p
                className={`mt-3 text-xs ${
                  deleteNoticeTone === "success" ? "text-watch-complete" : "text-watch-error"
                }`}
              >
                {deleteNotice}
              </p>
            )}
            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                className="watch-button"
                onClick={() => setDeleteOpen(false)}
                disabled={deleteLoading}
              >
                取消
              </button>
              <button
                type="button"
                className="watch-button watch-button--danger min-w-24"
                aria-busy={deleteLoading}
                onClick={handleDeleteAccount}
                disabled={deleteLoading}
              >
                <span className="watch-spinner-slot" aria-hidden="true">{deleteLoading && <span className="watch-spinner" />}</span>
                {deleteLoading ? "刪除中..." : "確認刪除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

