import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

export default function FriendsPage() {
  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <SiteHeader />
      <main className="min-h-screen px-6 pb-16 pt-24">
        <div className="mx-auto max-w-7xl">
          <div id="search-results-slot" className="mb-6" />
          <div className="page-content">
            <h1 className="text-2xl font-semibold">好友</h1>
            <p className="mt-2 text-sm text-white/60">尚未有好友資料。</p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
