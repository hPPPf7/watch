"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { supabase } from "@/lib/supabaseClient";

export default function AccountPage() {
  const [session, setSession] = useState<Session | null>(null);

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
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
