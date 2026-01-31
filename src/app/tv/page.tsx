"use client";

import { useState } from "react";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import RequireAuthGate from "@/components/RequireAuthGate";
import WatchlistSection from "@/components/WatchlistSection";

export default function TvPage() {
  const tabs = ["全部", "即將播出", "正在觀看", "已看完"] as const;
  const [activeTab, setActiveTab] =
    useState<(typeof tabs)[number]>("全部");
  const [filteredCount, setFilteredCount] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <SiteHeader />
      <main className="min-h-screen px-8 pb-16 pt-24">
        <div className="mx-auto h-full w-full pt-2">
          <div id="search-results-slot" className="mb-6" />
          <RequireAuthGate>
            <div className="page-content">
              <div className="fixed inset-x-0 top-16 z-10 border-b border-white/10 bg-[#0b0b0c]">
                <div className="flex h-11 w-full items-center justify-center gap-3 px-8 text-xs text-white/70">
                  {tabs.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`rounded-full border px-8 py-2 text-[11px] uppercase tracking-[0.2em] ${
                        activeTab === tab
                          ? "border-white/60 bg-white/10 text-white"
                          : "border-white/10 text-white/70 hover:border-white/30"
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-8 flex items-center gap-3">
                <h2 className="text-lg font-semibold text-white">影集清單</h2>
                {filteredCount !== null && (
                  <span className="text-xs text-white/50">
                    {filteredCount} 筆
                  </span>
                )}
              </div>
              <WatchlistSection
                title=""
                mediaType="tv"
                isAnime={false}
                onCountChange={setFilteredCount}
              />
            </div>
          </RequireAuthGate>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
