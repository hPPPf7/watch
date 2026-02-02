"use client";

import { useState } from "react";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import RequireAuthGate from "@/components/RequireAuthGate";
import WatchlistSection from "@/components/WatchlistSection";

export default function MoviesPage() {
  const tabs = ["全部", "即將上映", "未觀看", "已觀看"] as const;
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
              <WatchlistSection
                title="電影清單"
                mediaType="movie"
                filter={
                  activeTab === "即將上映"
                    ? "upcoming"
                    : activeTab === "未觀看"
                      ? "unwatched"
                      : activeTab === "已觀看"
                        ? "watched"
                        : "all"
                }
                onCountChange={setFilteredCount}
                headerCount={filteredCount}
              />
            </div>
          </RequireAuthGate>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
