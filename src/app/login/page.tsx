"use client";

import { Suspense } from "react";
import Image from "next/image";
import AuthPanel from "@/components/AuthPanel";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-watch-bg text-watch-text">
      <SiteHeader showLoginLink={false} />

      <main className="min-h-screen px-8 pb-16 pt-24">
        <div className="mx-auto w-full page-shell">
          <div id="search-results-slot" className="mb-6" />
          <div className="page-content">
            <div className="mb-8">
              <Image
                src="/watch-logo.svg"
                alt="Watch"
                width={1154}
                height={416}
                className="mx-auto mb-5 h-auto w-40"
                unoptimized
                priority
              />
              <p className="text-center text-sm text-watch-text-secondary">
                登入後可使用完整功能，未登入也可先瀏覽內容。
              </p>
            </div>
            <Suspense fallback={
              <p className="watch-loading justify-center text-sm" role="status">
                <span className="watch-spinner" aria-hidden="true" />
                載入登入服務...
              </p>
            }>
              <AuthPanel />
            </Suspense>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
