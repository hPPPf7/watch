"use client";

import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

export default function TvPage() {
  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <SiteHeader />
      <main className="min-h-screen px-6 pb-16 pt-28">
        <div className="mx-auto h-full w-full pt-2">
          <div id="search-results-slot" className="mb-6" />
          <div className="page-content">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <h2 className="text-lg font-semibold">影集</h2>
              <p className="mt-2 text-sm text-white/50">尚未設定內容。</p>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
