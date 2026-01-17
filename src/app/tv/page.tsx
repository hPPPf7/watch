"use client";

import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import RequireAuthGate from "@/components/RequireAuthGate";
import WatchlistSection from "@/components/WatchlistSection";

export default function TvPage() {
  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <SiteHeader />
      <main className="min-h-screen px-6 pb-16 pt-28">
        <div className="mx-auto h-full w-full pt-2">
          <RequireAuthGate>
            <div id="search-results-slot" className="mb-6" />
            <div className="page-content">
              <WatchlistSection title="影集清單" mediaType="tv" isAnime={false} />
            </div>
          </RequireAuthGate>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
