"use client";

import { Suspense } from "react";
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
              <p className="text-center text-sm text-white/60">
                登入後可使用完整功能，未登入也可先瀏覽內容。
              </p>
            </div>
            <Suspense fallback={null}>
              <AuthPanel />
            </Suspense>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
