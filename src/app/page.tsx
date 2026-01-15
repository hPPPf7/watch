import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <SiteHeader />

      <main className="min-h-screen px-6 pb-16 pt-20">
        <div className="mx-auto h-full max-w-6xl pt-10">
          <div id="search-results-slot" className="mb-6" />
          <div className="page-content">
            <section className="grid gap-6">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <h2 className="text-lg font-semibold">近期觀看</h2>
                <p className="mt-2 text-sm text-white/60">
                  尚未有觀看紀錄。開始新增你的第一部作品吧。
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <h2 className="text-lg font-semibold">待看清單</h2>
                <p className="mt-2 text-sm text-white/60">
                  將有興趣的電影或影集加入，這裡會列出清單。
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <h2 className="text-lg font-semibold">近期上線</h2>
                <p className="mt-2 text-sm text-white/60">
                  這裡會顯示即將上線與最新的影視作品。
                </p>
              </div>
            </section>
          </div>
        </div>
      </main>

      <SiteFooter />

    </div>
  );
}
