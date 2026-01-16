"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";

const translateAuthError = (message: string) => {
  const normalized = message.toLowerCase();
  const mappings: Array<[RegExp, string]> = [
    [/invalid login credentials/, "帳號或密碼錯誤，或帳號尚未註冊。"],
    [/email not confirmed/, "尚未完成信箱驗證，請先驗證後再登入。"],
    [/user already registered/, "此電子郵件已註冊，請直接登入。"],
    [/email rate limit exceeded/, "嘗試次數過多，請稍後再試。"],
    [/password should be at least/, "密碼長度不足，請設定更長的密碼。"],
    [/signup is disabled/, "目前暫停註冊，請稍後再試。"],
    [/invalid email/, "電子郵件格式不正確。"],
    [/unable to validate email address/, "電子郵件格式不正確。"],
    [/missing email/, "請輸入電子郵件。"],
    [/missing password/, "請輸入密碼。"],
  ];

  for (const [pattern, translation] of mappings) {
    if (pattern.test(normalized)) {
      return translation;
    }
  }

  return `發生錯誤：${message}`;
};

export default function AuthPanel() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data.session ?? null);
      setLoading(false);
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
    if (!session) return;

    const timer = window.setTimeout(() => {
      window.location.href = "/";
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [session]);

  const handleSignUp = async () => {
    setStatus("");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    });

    if (error) {
      setStatus(translateAuthError(error.message));
      return;
    }

    if (data?.user && data.user.identities?.length === 0) {
      setStatus("此電子郵件已註冊，請直接登入。");
      return;
    }

    setStatus("請至信箱完成驗證後再登入。");
  };

  const handleSignIn = async () => {
    setStatus("");
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setStatus(translateAuthError(error.message));
      return;
    }

    setStatus("登入成功，3 秒後回到首頁。");
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

      {!session && (
        <div className="mt-6 space-y-3">
          <input
            className="w-full rounded-lg border border-white/10 bg-black/40 px-8 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/30"
            type="email"
            placeholder="電子郵件"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
          <div className="relative">
            <input
              className="w-full rounded-lg border border-white/10 bg-black/40 px-8 py-2 pr-12 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/30"
              type={showPassword ? "text" : "password"}
              placeholder="密碼"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/60 hover:text-white"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "隱藏密碼" : "顯示密碼"}
            >
              {showPassword ? "隱藏" : "顯示"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        {!session && (
          <>
            <button
              className="rounded-full border border-white/15 px-8 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40"
              onClick={handleSignUp}
              disabled={loading}
            >
              註冊
            </button>
            <button
              className="rounded-full border border-white/15 px-8 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40"
              onClick={handleSignIn}
              disabled={loading}
            >
              登入
            </button>
          </>
        )}
      </div>

      {status && (
        <p className="mt-4 text-xs text-white/70" role="status">
          {status}
        </p>
      )}
    </section>
  );
}
