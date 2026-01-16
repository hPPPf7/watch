"use client";

import AuthPanel from "@/components/AuthPanel";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <SiteHeader showLoginLink={false} />

      <main className="min-h-screen px-8 pb-16 pt-24">
        <div className="mx-auto w-full page-shell">
          <div id="search-results-slot" className="mb-6" />
          <div className="page-content">
            <div className="mb-8">
              <h1 className="text-2xl font-semibold">登入</h1>
              <p className="mt-2 text-sm text-white/60">
                註冊後請收取驗證信，完成驗證才能登入。
              </p>
            </div>
            <AuthPanel />
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
