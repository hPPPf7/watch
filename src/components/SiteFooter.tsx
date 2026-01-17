import Image from "next/image";

const tmdbNotice =
  "This website uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.";

export default function SiteFooter() {
  return (
    <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[#0b0b0c]">
      <div className="flex w-full items-center justify-center gap-3 px-8 py-2 text-xs text-[#c7c7c7]">
        <Image
          src="/assets/tmdb/Primary%20short%20(blue)%20-%20SVG.svg"
          alt="TMDB logo"
          width={40}
          height={9}
          className="opacity-80"
          style={{ width: "60px", height: "14px" }}
          priority
        />
        <span>{tmdbNotice}</span>
      </div>
    </footer>
  );
}
