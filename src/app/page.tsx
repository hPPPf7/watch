import Image from "next/image";

export default function Home() {
  const tmdbNotice =
    "This website uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.";

  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <header className="fixed inset-x-0 top-0 z-20 h-16 border-b border-white/10 bg-[#0b0b0c]" />

      <main className="min-h-screen px-6 pb-16 pt-20">
        <div className="mx-auto h-full max-w-6xl" />
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[#0b0b0c]">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-2 text-xs text-[#c7c7c7]">
          <Image
            src="/assets/tmdb/Primary%20short%20(blue)%20-%20SVG.svg"
            alt="TMDB logo"
            width={72}
            height={16}
            className="h-4 w-auto opacity-80"
            priority
          />
          <span>{tmdbNotice}</span>
        </div>
      </footer>
    </div>
  );
}
