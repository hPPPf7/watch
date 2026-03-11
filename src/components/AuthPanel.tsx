"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getProviders, signIn } from "next-auth/react";
import useAuth from "@/hooks/useAuth";

const NEXT_REDIRECT_STORAGE_KEY = "watch.login.next";

export default function AuthPanel() {
  const [status, setStatus] = useState("");
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const { session, loading } = useAuth();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const authError = searchParams.get("error");
  const safeNext =
    next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  const storedNext =
    typeof window === "undefined"
      ? null
      : window.sessionStorage.getItem(NEXT_REDIRECT_STORAGE_KEY);
  const redirectTo = safeNext ?? (authError ? storedNext : null) ?? "/";
  const displayedStatus =
    authError ? "登入暫時無法完成，請稍後再試。" : status;

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
        setGoogleEnabled(Boolean(providers?.google));
      })
      .catch(() => {
        if (!mounted) return;
        setGoogleEnabled(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleGoogleSignIn = async () => {
    if (!googleEnabled) {
      setStatus("Google 登入尚未設定。");
      return;
    }
    setStatus("正在前往 Google 登入...");
    await signIn("google", { callbackUrl: redirectTo });
  };

  return (
    <section className="mx-auto w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-[0.2em] text-white/60">
          帳號
        </span>
        <span className="text-xs text-white/50">
          {session ? "已登入" : "未登入"}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap justify-center gap-3">
        {!session && (
          <button
            className="flex items-center justify-center gap-2 rounded-full border border-white/15 px-6 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40"
            onClick={handleGoogleSignIn}
            disabled={loading || !googleEnabled}
          >
            使用 Google 登入
          </button>
        )}
      </div>

      {displayedStatus && (
        <p
          className={`mt-4 text-xs ${
            displayedStatus.includes("失敗") ? "text-red-300" : "text-white/70"
          }`}
          role="status"
        >
          {displayedStatus}
        </p>
      )}
    </section>
  );
}

