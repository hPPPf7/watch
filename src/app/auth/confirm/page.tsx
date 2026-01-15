import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

export default function AuthConfirmPage() {
  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <SiteHeader showLoginLink={false} />
      <main className="min-h-screen px-6 pb-16 pt-24">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h1 className="text-2xl font-semibold">驗證完成</h1>
            <p className="mt-2 text-sm text-white/60">
              信箱驗證已完成，您已登入，可以直接開始使用。
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
