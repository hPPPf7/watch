"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getProviders, signIn } from "next-auth/react";
import { safeRedirectPath } from "@/lib/safeRedirectPath";
import useAuth from "@/hooks/useAuth";

const NEXT_REDIRECT_STORAGE_KEY = "watch.login.next";
type AuthStatus = { message: string; tone: "error" | "pending" };

export default function AuthPanel() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [providerState, setProviderState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [signInLoading, setSignInLoading] = useState(false);
  const { session, loading } = useAuth();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const authError = searchParams.get("error");
  const safeNext = safeRedirectPath(next);
  const storedNext =
    typeof window === "undefined"
      ? null
      : window.sessionStorage.getItem(NEXT_REDIRECT_STORAGE_KEY);
  const redirectTo = safeNext ?? (authError ? safeRedirectPath(storedNext) : null) ?? "/";
  const displayedStatus: AuthStatus | null = status ?? (
    authError ? { message: "登入暫時無法完成，請稍後再試。", tone: "error" }
      : providerState === "error" ? { message: "無法載入登入服務，請稍後重新整理。", tone: "error" }
        : providerState === "unavailable" ? { message: "Google 登入尚未設定。", tone: "error" }
          : providerState === "loading" ? { message: "載入登入服務...", tone: "pending" }
            : loading ? { message: "確認登入狀態...", tone: "pending" } : null
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (safeNext) {
      window.sessionStorage.setItem(NEXT_REDIRECT_STORAGE_KEY, safeNext);
    }
  }, [safeNext]);

  useEffect(() => {
    if (!session) return;

    const timer = window.setTimeout(() => {
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(NEXT_REDIRECT_STORAGE_KEY);
      }
      window.location.href = redirectTo;
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [redirectTo, session]);

  useEffect(() => {
    let mounted = true;
    getProviders()
      .then((providers) => {
        if (!mounted) return;
        setProviderState(!providers ? "error" : providers.google ? "ready" : "unavailable");
      })
      .catch(() => {
        if (!mounted) return;
        setProviderState("error");
      });
    return () => {
      mounted = false;
    };
  }, []);

  const pendingMessage = session
    ? "已登入，正在返回頁面..."
    : displayedStatus?.tone === "pending" ? displayedStatus.message : null;

  const handleGoogleSignIn = async () => {
    if (providerState !== "ready" || loading || signInLoading) return;
    setSignInLoading(true);
    setStatus({ message: "正在前往 Google 登入...", tone: "pending" });
    try {
      await signIn("google", { callbackUrl: redirectTo });
    } catch {
      setStatus({ message: "無法前往 Google 登入，請稍後再試。", tone: "error" });
      setSignInLoading(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-lg rounded-2xl border border-watch-border-subtle bg-watch-surface p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="shrink-0 text-xs text-watch-text-secondary">帳號</span>
        <span
          className="inline-flex min-w-0 items-center gap-2 text-xs text-watch-text-muted"
          role={pendingMessage ? "status" : undefined}
          title={pendingMessage ?? undefined}
        >
          {pendingMessage && <span className="watch-spinner" aria-hidden="true" />}
          <span className="truncate">{pendingMessage ?? (loading ? "確認登入狀態中" : session ? "已登入" : "未登入")}</span>
        </span>
      </div>

      {!session && (
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            className="watch-button"
            onClick={handleGoogleSignIn}
            disabled={loading || providerState !== "ready" || signInLoading}
          >
            使用 Google 登入
          </button>
        </div>
      )}

      {!session && displayedStatus?.tone === "error" && (
        <p className="mt-4 text-xs text-watch-error" role="alert">
          {displayedStatus.message}
        </p>
      )}
    </section>
  );
}
