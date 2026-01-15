import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <SiteHeader />
      <main className="min-h-screen px-6 pb-16 pt-24">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-2xl font-semibold">設定</h1>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
