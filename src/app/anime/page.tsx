import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

export default function AnimePage() {
  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <SiteHeader />
      <main className="min-h-screen px-6 pb-16 pt-24">
        <div className="mx-auto max-w-6xl">
          <div id="search-results-slot" className="mb-6" />
          <div className="page-content">
            <h1 className="text-2xl font-semibold">動畫</h1>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
