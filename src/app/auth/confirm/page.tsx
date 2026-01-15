export default function AuthConfirmPage() {
  return (
    <div className="min-h-screen bg-[#0b0b0c] px-6 py-24 text-[#e6e6e6]">
      <main className="mx-auto w-full max-w-lg">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
          <h1 className="text-2xl font-semibold">驗證完成</h1>
          <p className="mt-3 text-sm text-white/60">
            信箱驗證已完成，你已成功登入。
          </p>
          <p className="mt-1 text-xs text-white/50">
            可以關閉此頁面，回到原本的網站繼續操作。
          </p>
        </div>
      </main>
    </div>
  );
}
