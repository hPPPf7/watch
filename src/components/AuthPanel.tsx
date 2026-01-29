"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import useAuth from "@/hooks/useAuth";

export default function AuthPanel() {
  const [status, setStatus] = useState("");
  const { session, loading } = useAuth();

  useEffect(() => {
    if (!session) return;

    const timer = window.setTimeout(() => {
      window.location.href = "/";
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [session]);

  const handleGoogleSignIn = async () => {
    setStatus("正在前往 Google 登入...");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        queryParams: {
          prompt: "select_account",
        },
      },
    });
    if (error) {
      setStatus("Google 登入失敗，請稍後再試。");
    }
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

      <div className="mt-4 flex flex-wrap gap-3">
        {!session && (
          <button
            className="flex items-center justify-center gap-2 rounded-full border border-white/15 px-6 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40"
            onClick={handleGoogleSignIn}
            disabled={loading}
          >
            使用 Google 登入
          </button>
        )}
      </div>

      {status && (
        <p
          className={`mt-4 text-xs ${
            status.includes("失敗") ? "text-red-300" : "text-white/70"
          }`}
          role="status"
        >
          {status}
        </p>
      )}
    </section>
  );
}
