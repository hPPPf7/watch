"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";

type RequireAuthGateProps = {
  children: React.ReactNode;
};

export default function RequireAuthGate({ children }: RequireAuthGateProps) {
  const [session, setSession] = useState<Session | null>(null);
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
        setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return <div className="min-h-[60vh]" aria-hidden="true" />;
  }

  if (!session) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-white/60">請先登入以使用此功能。</p>
        <Link
          href="/login"
          className="rounded-full border border-white/15 px-8 py-2 text-xs uppercase tracking-[0.2em] text-white/80 transition hover:border-white/40"
        >
          登入
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
